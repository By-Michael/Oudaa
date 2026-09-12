const AppError = require('../utils/AppError');

/**
 * Validates req.body/query/params against a Zod schema shaped like:
 * { body: z.object({...}), query: z.object({...}), params: z.object({...}) }
 * Replaces req.body etc with the parsed (coerced/defaulted) result.
 */
module.exports = function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      // req.body is `undefined` (not `{}`) when the request has no
      // JSON Content-Type header at all, even with no body — normalize
      // to {} so schemas whose body fields are all-optional don't fail
      // just because the client didn't set a header.
      body: req.body ?? {},
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(new AppError('Validation failed', 400, details));
    }

    if (result.data.body) req.body = result.data.body;
    if (result.data.params) req.params = result.data.params;
    // req.query is a getter-only property on some Express/Node versions;
    // mutate in place instead of reassigning.
    if (result.data.query) Object.assign(req.query, result.data.query);

    next();
  };
};
