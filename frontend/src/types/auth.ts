export type AuthModule = 'fc' | 'flexo' | 'traslado';

export type AuthUser = {
  username: string;
  displayName: string;
  modules: AuthModule[];
};

export type AuthSessionResponse = {
  ok: boolean;
  authEnabled: boolean;
  user: AuthUser;
};
