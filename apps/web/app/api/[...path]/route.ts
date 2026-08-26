// The BFF: every call the browser makes to the API arrives here first, so that the
// session is a first-party cookie of this origin. The handler itself is the shell of the
// application and lives in the app layer, like the proxy and the layout.
export { DELETE, GET, PATCH, POST } from "#_app/bff";
