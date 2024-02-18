import type {
  NavigationState,
  PartialState,
  Route,
} from '@react-navigation/routers';
import * as queryString from 'query-string';

import type { PathConfig, PathConfigMap } from './types';
import { validatePathConfig } from './validatePathConfig';

type Options<ParamList extends {}> = {
  path?: string;
  initialRouteName?: string;
  screens: PathConfigMap<ParamList>;
};

type State = NavigationState | Omit<PartialState<NavigationState>, 'stale'>;

type StringifyConfig = Record<string, (value: any) => string>;

type ConfigItem = {
  pattern: string;
  stringify?: StringifyConfig;
  screens?: Record<string, ConfigItem | ConfigItem[]>;
};

const getActiveRoute = (state: State): { name: string; params?: object } => {
  const route =
    typeof state.index === 'number'
      ? state.routes[state.index]
      : state.routes[state.routes.length - 1];

  if (route.state) {
    return getActiveRoute(route.state);
  }

  return route;
};

/**
 * Utility to serialize a navigation state object to a path string.
 *
 * @example
 * ```js
 * getPathFromState(
 *   {
 *     routes: [
 *       {
 *         name: 'Chat',
 *         params: { author: 'Jane', id: 42 },
 *       },
 *     ],
 *   },
 *   {
 *     screens: {
 *       Chat: {
 *         path: 'chat/:author/:id',
 *         stringify: { author: author => author.toLowerCase() }
 *       }
 *     }
 *   }
 * )
 * ```
 *
 * @param state Navigation state to serialize.
 * @param options Extra options to fine-tune how to serialize the path.
 * @returns Path representing the state, e.g. /foo/bar?count=42.
 */
export function getPathFromState<ParamList extends {}>(
  state: State,
  options?: Options<ParamList>
): string {
  if (state == null) {
    throw Error(
      "Got 'undefined' for the navigation state. You must pass a valid state object."
    );
  }

  if (options) {
    validatePathConfig(options);
  }

  // Create a normalized configs object which will be easier to use
  const configs: Record<string, ConfigItem | ConfigItem[]> = options?.screens
    ? createNormalizedConfigs(options?.screens)
    : {};

  let path = '/';
  let current: State | undefined = state;

  const allParams: Record<string, any> = {};

  while (current) {
    let index = typeof current.index === 'number' ? current.index : 0;
    let route = current.routes[index] as Route<string> & {
      state?: State;
    };

    let pattern: string | undefined;

    let focusedParams: Record<string, any> | undefined;
    const focusedRoute = getActiveRoute(state);
    let currentOptions = configs;

    // Keep all the route names that appeared during going deeper in config in case the pattern is resolved to undefined
    const nestedRouteNames = [];

    let hasNext = true;

    const findMatchingConfigItem = (
      route: (Route<string> | Partial<Route<string>>) & { state?: State },
      options: Record<string, ConfigItem | ConfigItem[]>
    ) => {
      const configItem = route.name ? options[route.name] : undefined;

      if (!Array.isArray(configItem)) {
        return configItem;
      }

      return configItem.find((subConfigItem): boolean | undefined => {
        if (!route.path) {
          // No path on current route, so we can't match it with any pattern
          // Match possibly exists in nested route so match on nested route
          const nextRoute = route.state?.routes[route.state?.index || 0];
          return !!findMatchingConfigItem(nextRoute!, subConfigItem.screens!);
        }

        const normalizedPath = route.path.replace(/\/$/, '').replace(/^\//, '');

        return (
          !!subConfigItem.pattern &&
          !!normalizedPath &&
          patternToRegExp(subConfigItem.pattern).test(normalizedPath)
        );
      });
    };

    let configItem;

    while (route.name in currentOptions && hasNext) {
      configItem = findMatchingConfigItem(route, currentOptions);

      if (configItem === undefined) {
        throw new Error(
          `There is no matching screen for '${route.name}'. Make sure that you have configured a screen for the route and that the route is spelled correctly.`
        );
      }

      pattern = configItem.pattern;

      nestedRouteNames.push(route.name);

      if (route.params) {
        const stringify = configItem?.stringify;

        const currentParams = Object.fromEntries(
          Object.entries(route.params).map(([key, value]) => [
            key,
            stringify?.[key] ? stringify[key](value) : String(value),
          ])
        );

        if (pattern) {
          Object.assign(allParams, currentParams);
        }

        if (focusedRoute === route) {
          // If this is the focused route, keep the params for later use
          // We save it here since it's been stringified already
          focusedParams = { ...currentParams };

          pattern
            ?.split('/')
            .filter((p) => p.startsWith(':'))
            // eslint-disable-next-line no-loop-func
            .forEach((p) => {
              const name = getParamName(p);

              // Remove the params present in the pattern since we'll only use the rest for query string
              if (focusedParams) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete focusedParams[name];
              }
            });
        }
      }

      // If there is no `screens` property or no nested state, we return pattern
      if (!configItem.screens || route.state === undefined) {
        hasNext = false;
      } else {
        index =
          typeof route.state.index === 'number'
            ? route.state.index
            : route.state.routes.length - 1;

        const nextRoute = route.state.routes[index];
        const nestedConfig = configItem.screens;

        // if there is config for next route name, we go deeper
        if (nestedConfig && nextRoute.name in nestedConfig) {
          route = nextRoute as Route<string> & { state?: State };
          currentOptions = nestedConfig;
        } else {
          // If not, there is no sense in going deeper in config
          hasNext = false;
        }
      }
    }

    if (pattern === undefined) {
      pattern = nestedRouteNames.join('/');
    }

    if (currentOptions[route.name] !== undefined) {
      path += pattern
        .split('/')
        .map((p) => {
          const name = getParamName(p);

          // We don't know what to show for wildcard patterns
          // Showing the route name seems ok, though whatever we show here will be incorrect
          // Since the page doesn't actually exist
          if (p === '*') {
            return route.name;
          }

          // If the path has a pattern for a param, put the param in the path
          if (p.startsWith(':')) {
            const value = allParams[name];

            if (value === undefined && p.endsWith('?')) {
              // Optional params without value assigned in route.params should be ignored
              return '';
            }

            return encodeURIComponent(value);
          }

          return encodeURIComponent(p);
        })
        .join('/');
    } else {
      path += encodeURIComponent(route.name);
    }

    if (!focusedParams) {
      focusedParams = focusedRoute.params;
    }

    if (route.state) {
      path += '/';
    } else if (focusedParams) {
      for (const param in focusedParams) {
        if (focusedParams[param] === 'undefined') {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete focusedParams[param];
        }
      }

      const query = queryString.stringify(focusedParams, { sort: false });

      if (query) {
        path += `?${query}`;
      }
    }

    current = route.state;
  }

  // Remove multiple as well as trailing slashes
  path = path.replace(/\/+/g, '/');
  path = path.length > 1 ? path.replace(/\/$/, '') : path;

  // Include the root path if specified
  if (options?.path) {
    path = joinPaths(options.path, path);
  }

  return path;
}

const getParamName = (pattern: string) =>
  pattern.replace(/^:/, '').replace(/\?$/, '');

const joinPaths = (...paths: string[]): string =>
  ([] as string[])
    .concat(...paths.map((p) => p.split('/')))
    .filter(Boolean)
    .join('/');

const createConfigItem = (
  config: PathConfig<Record<string, any>> | string | undefined,
  parentPattern?: string
): ConfigItem => {
  if (typeof config === 'string') {
    // If a string is specified as the value of the key(e.g. Foo: '/path'), use it as the pattern
    const pattern = parentPattern ? joinPaths(parentPattern, config) : config;

    return { pattern };
  }

  if (config?.exact && config?.path === undefined) {
    throw new Error(
      "A 'path' needs to be specified when specifying 'exact: true'. If you don't want this screen in the URL, specify it as empty string, e.g. `path: ''`."
    );
  }

  // If an object is specified as the value (e.g. Foo: { ... }),
  // It can have `path` property and `screens` prop which has nested configs
  const pattern =
    config?.exact !== true
      ? joinPaths(parentPattern || '', config?.path || '')
      : config.path || '';

  const screens = config?.screens
    ? createNormalizedConfigs(config.screens, pattern)
    : undefined;

  return {
    // Normalize pattern to remove any leading, trailing slashes, duplicate slashes etc.
    pattern: pattern?.split('/').filter(Boolean).join('/'),
    stringify: config?.stringify,
    screens,
  };
};

const createNormalizedConfigs = (
  screens: PathConfigMap<Record<string, any>>,
  pattern?: string
): Record<string, ConfigItem | ConfigItem[]> =>
  Object.fromEntries(
    Object.entries(screens).map(([name, config]) => {
      // If an array is specified as the value of the key(e.g. Foo: [{ ... }, { ... }])
      if (Array.isArray(config)) {
        const result = config.map((c) => createConfigItem(c, pattern));
        return [name, result];
      }

      const result = createConfigItem(config, pattern);
      return [name, result];
    })
  );

export const patternToRegExp = (pattern: string): RegExp => {
  const colonParamRegex = /:([^/]+)/g;
  // Stuff between slashes or the end of the string
  const valueRegex = /([^/?]+)/;
  const _pattern = pattern
    .replace(colonParamRegex, valueRegex.source)
    // Replace the * with a permissive regex.
    .replace(/[*]/g, /.*/.source);

  const patternRegex = new RegExp(
    `^${_pattern}$` // to match path exactly
  );

  return patternRegex;
};
