export type AuthModule = 'fc' | 'flexo' | 'traslado';

export type AuthUser = {
  username: string;
  displayName: string;
  modules: AuthModule[];
  administrator: boolean;
};

export type AuthAccess = AuthUser & {
  active: boolean;
  createdAt?: string;
  createdBy?: string;
};

export type CreateAuthAccess = {
  displayName: string;
  username: string;
  password: string;
  modules: AuthModule[];
};

export type AuthSessionResponse = {
  ok: boolean;
  authEnabled: boolean;
  user: AuthUser;
};
