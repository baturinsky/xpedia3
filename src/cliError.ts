/**
 * Raised for anything the user can fix: bad arguments, missing files.
 *
 * It lives in its own module because more than one command-line part reports
 * such a problem: the message is printed on its own, without the stack a real
 * bug would need, so both have to agree on the same class.
 */
export class UsageError extends Error {}
