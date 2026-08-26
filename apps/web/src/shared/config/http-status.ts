/** The status codes the transport and the BFF branch on, named the way `HttpStatus` names them on the API side. */
export const HTTP_STATUS = {
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  NOT_MODIFIED: 304,
  UNAUTHORIZED: 401,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;
