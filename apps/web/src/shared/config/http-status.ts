/** The status codes the transport, the BFF and the pages branch on, named the way `HttpStatus` names them on the API side. */
export const HTTP_STATUS = {
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  NOT_MODIFIED: 304,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;
