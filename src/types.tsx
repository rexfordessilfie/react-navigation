import * as BaseActions from './BaseActions';

export type CommonAction = BaseActions.Action;

export type NavigationState = {
  index: number;
  names: string[];
  routes: Array<Route & { state?: NavigationState }>;
};

export type Route = {
  name: string;
  key: string;
  params?: {};
};

export type NavigationAction = {
  type: string;
};

export type Router<Action extends NavigationAction = NavigationAction> = {
  initial(options: {
    routeNames: string[];
    initialRouteName?: string;
  }): NavigationState;
  reduce(
    state: NavigationState,
    action: Action | CommonAction
  ): NavigationState | null;
  actions: { [key: string]: (...args: any) => Action };
};

export type NavigationHelpers<
  T extends { actions: Router['actions'] } = { actions: {} }
> = {
  dispatch: (action: NavigationAction) => void;
} & {
  [key in keyof typeof BaseActions]: (
    ...args: Parameters<typeof BaseActions[key]>
  ) => void;
} &
  {
    [key in keyof T['actions']]: (
      ...args: Parameters<T['actions'][key]>
    ) => void;
  };

export type NavigationProp<
  T extends { actions: Router['actions'] } = { actions: {} }
> = NavigationHelpers<T> & {
  state: Route | NavigationState;
};

export type Descriptor = {
  render(): React.ReactNode;
  options: Options;
};

export type Options = {
  title?: string;
  [key: string]: any;
};