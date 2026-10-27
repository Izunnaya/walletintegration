# Frontend

Placeholder. Nothing is built here yet.

The wallet service API lives in `../server`. A frontend added here would call it over HTTP; the API
is the contract, and the server never depends on anything in this folder.

When this is started, two things that already exist on the server side matter:

- Every response carries an `X-Request-Id`, and every error body repeats it as `error.requestId`.
  Surface it on an error screen so a user's report can be traced to a log line.
- Money crosses the wire as a string of kobo (`"150000"` is NGN 1,500), never a JSON number, because
  a JSON number is a float and would lose precision. Format for display only; never do arithmetic on
  the formatted value.
