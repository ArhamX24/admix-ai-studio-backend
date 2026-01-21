export const statusCodes = {
    OK: 200, // when we are fetching any thing it comess successfully 
    CREATED: 201, // when user is successfully created 
    NOCONTENT: 204, // if user send empty data
    BADREQUEST: 400, // if user continue without for ex - without password entry 
    UNAUTHORIZED: 401, // when user is not authenticated 
    FORBIDDEN: 403, // when user not have permisson for that path
    NOTFOUND: 404, // used when for ex - user with this email not found 
    CONFLICT: 409, // used when forex- email already exists with current name
    SERVERERR: 500
}