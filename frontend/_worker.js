// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_);
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * `.bytes()` parses the request body as a `Uint8Array`.
   *
   * @see {@link https://hono.dev/docs/api/request#bytes}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.bytes()
   * })
   * ```
   */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
};
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// worker/api/notes.ts
var CLOZE_PATTERN = /\{\{c(\d+)::([^:}]+)(?:::(.*?[^\\]))?\}\}/g;
var NOTE_TYPES = Object.freeze({
  BASIC: "Basic",
  BASIC_REVERSED: "Basic (and reversed card)",
  BASIC_OPTIONAL_REVERSED: "Basic (optional reversed card)",
  BASIC_TYPE_IN_ANSWER: "Basic (type in the answer)",
  CLOZE: "Cloze",
  IMAGE_OCCLUSION: "Image Occlusion"
});
function generateCards(noteType, fields) {
  switch (noteType) {
    case NOTE_TYPES.BASIC:
      return generateBasicCards(fields);
    case NOTE_TYPES.BASIC_REVERSED:
      return generateBasicReversedCards(fields);
    case NOTE_TYPES.BASIC_OPTIONAL_REVERSED:
      return generateBasicOptionalReversedCards(fields);
    case NOTE_TYPES.BASIC_TYPE_IN_ANSWER:
      return generateBasicTypeInAnswerCards(fields);
    case NOTE_TYPES.CLOZE:
      return generateClozeCards(fields);
    case NOTE_TYPES.IMAGE_OCCLUSION:
      return generateImageOcclusionCards(fields);
    default:
      return generateBasicCards(fields);
  }
}
function countClozeNumbers(text) {
  const numbers = /* @__PURE__ */ new Set();
  let match2;
  const regex = new RegExp(CLOZE_PATTERN);
  while ((match2 = regex.exec(text)) !== null) {
    numbers.add(parseInt(match2[1], 10));
  }
  return numbers;
}
function generateBasicCards(fields) {
  const front = (fields["Front"] || "").trim();
  if (!front) return [];
  const back = fields["Back"] || "";
  return [
    {
      front,
      back,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)"
    }
  ];
}
function generateBasicReversedCards(fields) {
  const front = (fields["Front"] || "").trim();
  const back = (fields["Back"] || "").trim();
  const cards = [];
  if (front) {
    cards.push({
      front,
      back: fields["Back"] || "",
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)"
    });
  }
  if (back) {
    cards.push({
      front: back,
      back: front,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: true,
      templateName: "Card 2 (Back -> Front)"
    });
  }
  return cards;
}
function generateBasicOptionalReversedCards(fields) {
  const front = (fields["Front"] || "").trim();
  const back = (fields["Back"] || "").trim();
  const addReverse = (fields["Add Reverse"] || "").trim();
  const cards = [];
  if (front) {
    cards.push({
      front,
      back: fields["Back"] || "",
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: false,
      templateName: "Card 1 (Front -> Back)"
    });
  }
  if (addReverse && back) {
    cards.push({
      front: back,
      back: front,
      clozeIndex: 0,
      clozeCount: 0,
      isReversed: true,
      templateName: "Card 2 (Back -> Front)"
    });
  }
  return cards;
}
function generateBasicTypeInAnswerCards(fields) {
  return generateBasicCards(fields);
}
function generateClozeCards(fields) {
  const text = fields["Text"] || "";
  const backExtra = fields["Back Extra"] || "";
  const clozeNumbers = countClozeNumbers(text);
  if (clozeNumbers.size === 0) {
    if (!text.trim()) return [];
    return [
      {
        front: text,
        back: backExtra || text,
        clozeIndex: 0,
        clozeCount: 0,
        isReversed: false,
        templateName: "Cloze"
      }
    ];
  }
  const sortedNumbers = Array.from(clozeNumbers).sort((a, b) => a - b);
  return sortedNumbers.map((clozeNum) => ({
    front: renderClozeFront(text, clozeNum),
    back: renderClozeBack(text, clozeNum) + (backExtra ? `
<hr id="answer">
${backExtra}` : ""),
    clozeIndex: clozeNum,
    clozeCount: clozeNumbers.size,
    isReversed: false,
    templateName: `Cloze (c${clozeNum})`
  }));
}
function generateImageOcclusionCards(fields) {
  try {
    const imageUrl = fields["Image"] || "";
    const occlusionData = fields["OcclusionData"] || "[]";
    const masks = JSON.parse(occlusionData);
    const cards = [];
    masks.forEach((mask) => {
      if (mask.is_card) {
        cards.push({
          front: imageUrl,
          back: JSON.stringify({ occlusionData, activeMaskId: mask.id }),
          clozeIndex: 0,
          clozeCount: masks.filter((m) => m.is_card).length,
          isReversed: false,
          templateName: `Image Occlusion (${mask.id})`
        });
      }
    });
    return cards;
  } catch {
    return [];
  }
}
function renderClozeFront(text, targetIndex) {
  return text.replace(new RegExp(CLOZE_PATTERN), (match2, p1, p2, p3) => {
    const clozeNum = parseInt(p1, 10);
    const answerText = p2;
    const hint = p3;
    if (clozeNum === targetIndex) {
      return hint ? `[${hint}]` : "[...]";
    }
    return answerText;
  });
}
function renderClozeBack(text, targetIndex) {
  return text.replace(new RegExp(CLOZE_PATTERN), (match2, p1, p2) => {
    const clozeNum = parseInt(p1, 10);
    const answerText = p2;
    if (clozeNum === targetIndex) {
      return `<strong>${answerText}</strong>`;
    }
    return answerText;
  });
}

// worker/api/parser.ts
var FILTER_TAGS = /* @__PURE__ */ new Set(["\u8981\u524A\u9664"]);
function parseHeaderLine(line) {
  if (!line.startsWith("#")) {
    return null;
  }
  const content = line.substring(1).trim();
  const colonIndex = content.indexOf(":");
  if (colonIndex !== -1) {
    const key = content.substring(0, colonIndex).trim().toLowerCase();
    const value = content.substring(colonIndex + 1).trim();
    return [key, value];
  }
  return [content.toLowerCase(), ""];
}
function parseHeaders(lines) {
  const header = {
    separator: "	",
    html: true,
    guidColumn: 1,
    notetypeColumn: 2,
    deckColumn: 3,
    tagsColumn: 7
  };
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const result = parseHeaderLine(lines[i]);
    if (result === null) {
      dataStart = i;
      break;
    }
    const [key, value] = result;
    if (key === "separator" && value === "tab") {
      header.separator = "	";
    } else if (key === "separator") {
      header.separator = value;
    } else if (key === "html") {
      header.html = value.toLowerCase() === "true";
    } else if (key === "guid column") {
      header.guidColumn = parseInt(value, 10);
    } else if (key === "notetype column") {
      header.notetypeColumn = parseInt(value, 10);
    } else if (key === "deck column") {
      header.deckColumn = parseInt(value, 10);
    } else if (key === "tags column") {
      header.tagsColumn = parseInt(value, 10);
    }
    dataStart = i + 1;
  }
  return { header, dataStart };
}
function splitTabWithQuotes(line, separator = "	") {
  const fields = [];
  let current = [];
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current.push('"');
        i++;
      } else if (i + 1 >= line.length || line[i + 1] === separator) {
        inQuotes = false;
      } else {
        inQuotes = false;
        current.push(line[i + 1]);
        i++;
      }
    } else if (ch === separator && !inQuotes) {
      fields.push(current.join(""));
      current = [];
    } else {
      current.push(ch);
    }
  }
  fields.push(current.join(""));
  return fields;
}
function buildFieldMap(noteType, fields) {
  const safeGet = (idx) => {
    if (idx >= 0 && idx < fields.length) return fields[idx];
    return "";
  };
  switch (noteType) {
    case NOTE_TYPES.CLOZE:
      return {
        "Text": safeGet(3),
        "Back Extra": safeGet(4)
      };
    case NOTE_TYPES.BASIC_OPTIONAL_REVERSED:
      return {
        "Front": safeGet(3),
        "Back": safeGet(4),
        "Add Reverse": safeGet(5)
      };
    case NOTE_TYPES.IMAGE_OCCLUSION:
      return {
        "Image": safeGet(3),
        "Header": safeGet(4),
        "Footer": safeGet(5),
        "OcclusionData": safeGet(6)
      };
    // Basic, Basic (and reversed card), Basic (type in the answer) は同構造
    case NOTE_TYPES.BASIC:
    case NOTE_TYPES.BASIC_REVERSED:
    case NOTE_TYPES.BASIC_TYPE_IN_ANSWER:
    default:
      return {
        "Front": safeGet(3),
        "Back": safeGet(4)
      };
  }
}
function hasFilterTags(tagsStr) {
  if (!tagsStr.trim()) {
    return false;
  }
  const tagList = tagsStr.trim().split(/\s+/);
  return tagList.some((tag) => FILTER_TAGS.has(tag));
}
function parseDataLine(line, header) {
  if (!line.trim()) {
    return null;
  }
  const fields = splitTabWithQuotes(line, header.separator);
  const safeGetCol = (col) => {
    const idx = col - 1;
    return idx >= 0 && idx < fields.length ? fields[idx] : "";
  };
  const guid = safeGetCol(header.guidColumn);
  const noteType = safeGetCol(header.notetypeColumn);
  const deckName = safeGetCol(header.deckColumn);
  const tags = safeGetCol(header.tagsColumn);
  const front = fields.length > 3 ? fields[3] : "";
  const back = fields.length > 4 ? fields[4] : "";
  const field5 = fields.length > 5 ? fields[5] : "";
  if (!guid) {
    return null;
  }
  if (hasFilterTags(tags)) {
    return null;
  }
  return [guid, noteType, deckName, front, back, field5, tags];
}
function expandCards(guid, noteType, deckName, front, back, field5, tags) {
  const fieldsArr = [guid, noteType, deckName, front, back, field5];
  const fieldMap = buildFieldMap(noteType, fieldsArr);
  const renderedCards = generateCards(noteType, fieldMap);
  return renderedCards.map((rc) => ({
    guid,
    note_type: noteType,
    deck_name: deckName,
    front: rc.front,
    back: rc.back,
    tags,
    cloze_count: rc.clozeCount,
    cloze_index: rc.clozeIndex,
    is_reversed: rc.isReversed
  }));
}
function parseAnkiFile(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }
  const { header, dataStart } = parseHeaders(lines);
  const allCards = [];
  for (let i = dataStart; i < lines.length; i++) {
    const parsed = parseDataLine(lines[i], header);
    if (parsed === null) {
      continue;
    }
    const [guid, noteType, deckName, front, back, field5, tags] = parsed;
    const expanded = expandCards(guid, noteType, deckName, front, back, field5, tags);
    allCards.push(...expanded);
  }
  return allCards;
}

// worker/api/srs.ts
var SRS_DEFAULT_EASE_FACTOR = 2.5;
var SRS_MIN_EASE_FACTOR = 1.3;
function calculateNextReview(state, rating) {
  const now = /* @__PURE__ */ new Date();
  let ease = state.easeFactor ?? SRS_DEFAULT_EASE_FACTOR;
  let interval = state.intervalDays ?? 0;
  let reps = state.repetitions ?? 0;
  let lapses = state.lapses ?? 0;
  let status = state.status ?? "new";
  if (interval === 0) {
    if (rating === 1 /* AGAIN */ || rating === 2 /* HARD */) {
      interval = 0;
      if (rating === 1 /* AGAIN */) lapses += 1;
      status = "learning";
      reps = 0;
    } else if (rating === 3 /* GOOD */) {
      interval = 1;
      status = "review";
      reps += 1;
    } else if (rating === 4 /* EASY */) {
      interval = 4;
      status = "review";
      reps += 1;
    }
  } else {
    if (rating === 1 /* AGAIN */) {
      interval = 0;
      ease = Math.max(SRS_MIN_EASE_FACTOR, ease - 0.2);
      lapses += 1;
      status = "learning";
      reps = 0;
    } else if (rating === 2 /* HARD */) {
      interval = Math.max(interval + 1, interval * 1.2);
      ease = Math.max(SRS_MIN_EASE_FACTOR, ease - 0.15);
      status = "review";
      reps += 1;
    } else if (rating === 3 /* GOOD */) {
      interval = interval * ease;
      status = "review";
      reps += 1;
    } else if (rating === 4 /* EASY */) {
      interval = interval * ease * 1.3;
      ease += 0.15;
      status = "review";
      reps += 1;
    }
  }
  const nextReviewAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1e3);
  const round = (num, decimals) => {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  };
  return {
    easeFactor: round(ease, 4),
    intervalDays: round(interval, 4),
    repetitions: reps,
    lapses,
    nextReviewAt,
    status
  };
}

// worker/index.ts
var app = new Hono2().basePath("/api");
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 48; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
app.use("*", async (c, next) => {
  const db = c.env.DB;
  await runMigrations(db);
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  const publicPaths = ["/api/auth/login", "/api/auth/register"];
  if (publicPaths.includes(pathname)) {
    c.set("user", null);
    await next();
    return;
  }
  if (pathname.startsWith("/api/")) {
    let token = c.req.query("token");
    if (!token) {
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }
    if (!token) {
      return c.json({ error: "\u8A8D\u8A3C\u30A8\u30E9\u30FC: \u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044" }, 401);
    }
    const user = await db.prepare("SELECT id, username, is_admin FROM users WHERE session_token = ?").bind(token).first();
    if (!user) {
      return c.json({ error: "\u8A8D\u8A3C\u30A8\u30E9\u30FC: \u7121\u52B9\u306A\u30BB\u30C3\u30B7\u30E7\u30F3\u3067\u3059\u3002\u518D\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044" }, 401);
    }
    c.set("user", { id: user.id, username: user.username, is_admin: !!user.is_admin });
  }
  await next();
});
var migrationDone = false;
async function runMigrations(db) {
  if (migrationDone) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        username        TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        session_token   TEXT,
        is_admin        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (e) {
    console.error("[Migration] users table creation error:", e);
  }
  try {
    const info = await db.prepare("PRAGMA table_info(card_states)").all();
    const columnNames = info.results.map((r) => r.name);
    const hasUserId = columnNames.includes("user_id");
    if (!hasUserId) {
      console.log("[Migration] card_states missing user_id, starting migration...");
      await db.prepare("ALTER TABLE card_states RENAME TO card_states_old").run();
      await db.prepare(`
        CREATE TABLE card_states (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          card_id         INTEGER NOT NULL,
          user_id         INTEGER NOT NULL,
          ease_factor     REAL NOT NULL DEFAULT 2.5,
          interval_days   REAL NOT NULL DEFAULT 0,
          repetitions     INTEGER NOT NULL DEFAULT 0,
          lapses          INTEGER NOT NULL DEFAULT 0,
          next_review_at  TEXT,
          last_reviewed_at TEXT,
          status          TEXT NOT NULL DEFAULT 'new',
          FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(card_id, user_id)
        )
      `).run();
      const hasOldLapses = columnNames.includes("lapses");
      const lapsesCol = hasOldLapses ? "COALESCE(lapses, 0)" : "0";
      await db.prepare(`
        INSERT OR IGNORE INTO card_states (card_id, user_id, ease_factor, interval_days, repetitions, lapses, next_review_at, last_reviewed_at, status)
        SELECT card_id, 1, ease_factor, interval_days, repetitions, ${lapsesCol}, next_review_at, last_reviewed_at, status
        FROM card_states_old
      `).run();
      await db.prepare("DROP TABLE IF EXISTS card_states_old").run();
      console.log("[Migration] card_states migrated successfully");
    }
  } catch (e) {
    console.error("[Migration] card_states migration error:", e);
    try {
      const check = await db.prepare("PRAGMA table_info(card_states_old)").all();
      if (check.results.length > 0) {
        await db.prepare("DROP TABLE IF EXISTS card_states").run();
        await db.prepare("ALTER TABLE card_states_old RENAME TO card_states").run();
        console.log("[Migration] card_states migration rolled back");
      }
    } catch (recoverErr) {
      console.error("[Migration] card_states recovery failed:", recoverErr);
    }
  }
  try {
    const info = await db.prepare("PRAGMA table_info(review_logs)").all();
    if (!info.results.some((r) => r.name === "user_id")) {
      await db.prepare("ALTER TABLE review_logs ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1").run();
      console.log("[Migration] review_logs.user_id added");
    }
  } catch (e) {
    console.error("[Migration] review_logs migration error:", e);
  }
  try {
    const info = await db.prepare("PRAGMA table_info(deck_options)").all();
    const columnNames = info.results.map((r) => r.name);
    const hasUserId = columnNames.includes("user_id");
    if (!hasUserId) {
      console.log("[Migration] deck_options missing user_id, starting migration...");
      await db.prepare("ALTER TABLE deck_options RENAME TO deck_options_old").run();
      const hasExcludedTags = columnNames.includes("excluded_tags");
      await db.prepare(`
        CREATE TABLE deck_options (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          deck_id          INTEGER NOT NULL,
          user_id          INTEGER NOT NULL,
          max_new_cards    INTEGER NOT NULL DEFAULT 20,
          max_review_cards INTEGER NOT NULL DEFAULT 100,
          review_order     TEXT NOT NULL DEFAULT 'random',
          excluded_tags    TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(deck_id, user_id)
        )
      `).run();
      const excludedTagsCol = hasExcludedTags ? "excluded_tags" : "''";
      await db.prepare(`
        INSERT OR IGNORE INTO deck_options (deck_id, user_id, max_new_cards, max_review_cards, review_order, excluded_tags)
        SELECT deck_id, 1, max_new_cards, max_review_cards, review_order, ${excludedTagsCol}
        FROM deck_options_old
      `).run();
      await db.prepare("DROP TABLE IF EXISTS deck_options_old").run();
      console.log("[Migration] deck_options migrated successfully");
    }
  } catch (e) {
    console.error("[Migration] deck_options migration error:", e);
    try {
      const check = await db.prepare("PRAGMA table_info(deck_options_old)").all();
      if (check.results.length > 0) {
        await db.prepare("DROP TABLE IF EXISTS deck_options").run();
        await db.prepare("ALTER TABLE deck_options_old RENAME TO deck_options").run();
        console.log("[Migration] deck_options migration rolled back");
      }
    } catch (recoverErr) {
      console.error("[Migration] deck_options recovery failed:", recoverErr);
    }
  }
  try {
    const adminHash = await sha256("SukilHaakuAdmin116");
    await db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, is_admin)
      VALUES (1, '2379862', ?, 1)
    `).bind(adminHash).run();
  } catch (e) {
    console.error("[Migration] admin seed error:", e);
  }
  migrationDone = true;
}
function getUserId(c) {
  const user = c.get("user");
  if (!user) throw new Error("\u8A8D\u8A3C\u304C\u5FC5\u8981\u3067\u3059");
  return user.id;
}
async function getDeckCounts(db, deckId, userId) {
  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
    WHERE c.deck_id = ?
  `;
  const result = await db.prepare(query).bind(userId, deckId).first();
  return {
    total: result?.total || 0,
    new_count: result?.new_count || 0,
    learning_count: result?.learning_count || 0,
    review_count: result?.review_count || 0
  };
}
async function getStudyableCount(db, deckId, excludedTags, userId) {
  const excludedList = excludedTags ? excludedTags.trim().split(/\s+/).filter(Boolean) : [];
  if (excludedList.length === 0) {
    const counts = await getDeckCounts(db, deckId, userId);
    return counts.total;
  }
  const { results: allRows } = await db.prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''").bind(deckId).all();
  const allTags = /* @__PURE__ */ new Set();
  for (const row of allRows) {
    for (const tag of row.tags.trim().split(/\s+/)) {
      if (tag) allTags.add(tag);
    }
  }
  const includedTags = [...allTags].filter((t) => !excludedList.includes(t));
  if (includedTags.length === 0) return 0;
  const conditions = includedTags.map(() => `INSTR(' ' || c.tags || ' ', ?) > 0`);
  const params = includedTags.map((t) => ` ${t} `);
  const result = await db.prepare(`SELECT COUNT(*) as total FROM cards c WHERE c.deck_id = ? AND (${conditions.join(" OR ")})`).bind(deckId, ...params).first();
  return result?.total || 0;
}
app.post("/auth/login", async (c) => {
  const db = c.env.DB;
  try {
    const { username, password } = await c.req.json();
    if (!username || username.trim() === "") {
      return c.json({ error: "ID\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }, 400);
    }
    const user = await db.prepare("SELECT id, username, password_hash, is_admin FROM users WHERE username = ?").bind(username.trim()).first();
    if (!user) {
      if (!password || password.trim() === "") {
        return c.json({ status: "new_account", username: username.trim() }, 200);
      }
      return c.json({ error: "\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u5B58\u5728\u3057\u307E\u305B\u3093" }, 404);
    }
    const inputHash = await sha256(password);
    if (inputHash !== user.password_hash) {
      return c.json({ error: "\u30D1\u30B9\u30EF\u30FC\u30C9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093" }, 401);
    }
    const token = generateToken();
    await db.prepare("UPDATE users SET session_token = ? WHERE id = ?").bind(token, user.id).run();
    return c.json({
      success: true,
      token,
      is_admin: !!user.is_admin,
      username: user.username
    });
  } catch (err) {
    return c.json({ error: `\u30ED\u30B0\u30A4\u30F3\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/auth/register", async (c) => {
  const db = c.env.DB;
  try {
    const { username, password } = await c.req.json();
    if (!username || username.trim() === "") {
      return c.json({ error: "ID\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }, 400);
    }
    if (!password || password.trim() === "") {
      return c.json({ error: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }, 400);
    }
    const uname = username.trim();
    const existing = await db.prepare("SELECT id FROM users WHERE username = ?").bind(uname).first();
    if (existing) {
      return c.json({ error: "\u3053\u306EID\u306F\u65E2\u306B\u4F7F\u7528\u3055\u308C\u3066\u3044\u307E\u3059" }, 409);
    }
    const passwordHash = await sha256(password);
    const token = generateToken();
    await db.prepare("INSERT INTO users (username, password_hash, session_token, is_admin) VALUES (?, ?, ?, 0)").bind(uname, passwordHash, token).run();
    return c.json({
      success: true,
      token,
      is_admin: false,
      username: uname
    });
  } catch (err) {
    return c.json({ error: `\u30A2\u30AB\u30A6\u30F3\u30C8\u4F5C\u6210\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/auth/logout", async (c) => {
  const db = c.env.DB;
  try {
    const userId = getUserId(c);
    await db.prepare("UPDATE users SET session_token = NULL WHERE id = ?").bind(userId).run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `\u30ED\u30B0\u30A2\u30A6\u30C8\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.get("/auth/me", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "\u8A8D\u8A3C\u3055\u308C\u3066\u3044\u307E\u305B\u3093" }, 401);
  }
  return c.json({
    id: user.id,
    username: user.username,
    is_admin: user.is_admin
  });
});
function requireAdmin(c) {
  const user = c.get("user");
  if (!user || !user.is_admin) {
    throw new Error("\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059");
  }
  return user;
}
app.get("/admin/users", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const { results: users } = await db.prepare("SELECT id, username, is_admin, created_at, session_token IS NOT NULL as logged_in FROM users ORDER BY id").all();
    return c.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        is_admin: !!u.is_admin,
        created_at: u.created_at,
        logged_in: !!u.logged_in
      }))
    );
  } catch (err) {
    if (err.message === "\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `\u30E6\u30FC\u30B6\u30FC\u4E00\u89A7\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.delete("/admin/users/:userId", async (c) => {
  const db = c.env.DB;
  try {
    const admin = requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);
    if (isNaN(userId)) return c.json({ error: "\u7121\u52B9\u306A\u30E6\u30FC\u30B6\u30FCID\u3067\u3059" }, 400);
    const target = await db.prepare("SELECT id, username, is_admin FROM users WHERE id = ?").bind(userId).first();
    if (!target) return c.json({ error: "\u30E6\u30FC\u30B6\u30FC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    if (target.is_admin) return c.json({ error: "\u7BA1\u7406\u8005\u30A2\u30AB\u30A6\u30F3\u30C8\u306F\u524A\u9664\u3067\u304D\u307E\u305B\u3093" }, 400);
    if (target.id === admin.id) return c.json({ error: "\u81EA\u5206\u81EA\u8EAB\u306F\u524A\u9664\u3067\u304D\u307E\u305B\u3093" }, 400);
    await db.batch([
      db.prepare("DELETE FROM card_states WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM review_logs WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM deck_options WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userId)
    ]);
    return c.json({ success: true, message: `\u30A2\u30AB\u30A6\u30F3\u30C8\u300C${target.username}\u300D\u3092\u524A\u9664\u3057\u307E\u3057\u305F` });
  } catch (err) {
    if (err.message === "\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `\u30A2\u30AB\u30A6\u30F3\u30C8\u524A\u9664\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/admin/users/:userId/password", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);
    if (isNaN(userId)) return c.json({ error: "\u7121\u52B9\u306A\u30E6\u30FC\u30B6\u30FCID\u3067\u3059" }, 400);
    const { password } = await c.req.json();
    if (!password || password.trim() === "") {
      return c.json({ error: "\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044" }, 400);
    }
    const target = await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first();
    if (!target) return c.json({ error: "\u30E6\u30FC\u30B6\u30FC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    const passwordHash = await sha256(password);
    await db.prepare("UPDATE users SET password_hash = ?, session_token = NULL WHERE id = ?").bind(passwordHash, userId).run();
    return c.json({ success: true, message: `\u30A2\u30AB\u30A6\u30F3\u30C8\u300C${target.username}\u300D\u306E\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5909\u66F4\u3057\u307E\u3057\u305F` });
  } catch (err) {
    if (err.message === "\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `\u30D1\u30B9\u30EF\u30FC\u30C9\u5909\u66F4\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/admin/users/:userId/reset", async (c) => {
  const db = c.env.DB;
  try {
    requireAdmin(c);
    const userId = parseInt(c.req.param("userId"), 10);
    if (isNaN(userId)) return c.json({ error: "\u7121\u52B9\u306A\u30E6\u30FC\u30B6\u30FCID\u3067\u3059" }, 400);
    const target = await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(userId).first();
    if (!target) return c.json({ error: "\u30E6\u30FC\u30B6\u30FC\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    await db.batch([
      db.prepare("DELETE FROM review_logs WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM card_states WHERE user_id = ?").bind(userId)
    ]);
    return c.json({ success: true, message: `\u30A2\u30AB\u30A6\u30F3\u30C8\u300C${target.username}\u300D\u306E\u5B66\u7FD2\u72B6\u614B\u3092\u30EA\u30BB\u30C3\u30C8\u3057\u307E\u3057\u305F` });
  } catch (err) {
    if (err.message === "\u7BA1\u7406\u8005\u6A29\u9650\u304C\u5FC5\u8981\u3067\u3059") {
      return c.json({ error: err.message }, 403);
    }
    return c.json({ error: `\u5B66\u7FD2\u72B6\u614B\u30EA\u30BB\u30C3\u30C8\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.get("/decks", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  try {
    const { results: decks } = await db.prepare("SELECT id, name, created_at FROM decks ORDER BY name").all();
    const result = [];
    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id, userId);
      const options = await db.prepare("SELECT max_new_cards, max_review_cards, excluded_tags FROM deck_options WHERE deck_id = ? AND user_id = ?").bind(deck.id, userId).first();
      const dailyTaskLimit = (options?.max_new_cards || 20) + (options?.max_review_cards || 100);
      const studyableCount = await getStudyableCount(db, deck.id, options?.excluded_tags || "", userId);
      const todayStart = /* @__PURE__ */ new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const todayResult = await db.prepare(
        `SELECT COUNT(*) as today FROM review_logs
           WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?`
      ).bind(todayStart.toISOString(), deck.id, userId).first();
      const reviewsToday = todayResult?.today || 0;
      const dailyRemaining = Math.max(0, dailyTaskLimit - reviewsToday);
      result.push({
        id: deck.id,
        name: deck.name,
        created_at: deck.created_at,
        card_count: counts.total,
        studyable_count: studyableCount,
        new_count: counts.new_count,
        learning_count: counts.learning_count,
        review_count: counts.review_count,
        reviews_today: reviewsToday,
        daily_remaining: dailyRemaining,
        card_counts: {
          total: counts.total,
          new: counts.new_count,
          learning: counts.learning_count,
          review: counts.review_count
        }
      });
    }
    return c.json(result, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
  } catch (err) {
    return c.json({ error: `\u30C7\u30C3\u30AD\u4E00\u89A7\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/import", async (c) => {
  const db = c.env.DB;
  try {
    const formData = await c.req.raw.formData();
    const file = formData.get("file");
    if (!file) {
      return c.json({ error: "\u30D5\u30A1\u30A4\u30EB\u304C\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3055\u308C\u3066\u3044\u307E\u305B\u3093" }, 400);
    }
    const raw2 = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const content = decoder.decode(raw2);
    const parsedCards = parseAnkiFile(content);
    if (parsedCards.length === 0) {
      return c.json({
        success: false,
        message: "\u30AB\u30FC\u30C9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30D5\u30A1\u30A4\u30EB\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      });
    }
    const deckCache = {};
    const decksCreated = [];
    const uniqueNotes = /* @__PURE__ */ new Set();
    const uniqueDeckNames = Array.from(new Set(parsedCards.map((c2) => c2.deck_name)));
    const existingDecks = await db.prepare("SELECT id, name FROM decks").all();
    for (const d of existingDecks.results) {
      deckCache[d.name] = d.id;
    }
    const missingDecks = uniqueDeckNames.filter((name) => !deckCache[name]);
    if (missingDecks.length > 0) {
      const deckPlaceholders = missingDecks.map(() => "(?)").join(", ");
      await db.prepare(`INSERT OR IGNORE INTO decks (name) VALUES ${deckPlaceholders}`).bind(...missingDecks).run();
      const newDecks = await db.prepare("SELECT id, name FROM decks").all();
      for (const d of newDecks.results) {
        deckCache[d.name] = d.id;
        if (missingDecks.includes(d.name)) {
          decksCreated.push(d.name);
        }
      }
    }
    let cardsCreated = 0;
    const BATCH_SIZE = 10;
    const insertStmts = [];
    for (let i = 0; i < parsedCards.length; i += BATCH_SIZE) {
      const chunk = parsedCards.slice(i, i + BATCH_SIZE);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params = [];
      for (const card of chunk) {
        uniqueNotes.add(card.guid);
        params.push(
          card.guid,
          deckCache[card.deck_name],
          card.note_type,
          card.front,
          card.back,
          card.tags,
          card.cloze_count,
          card.cloze_index,
          card.is_reversed ? 1 : 0
        );
      }
      insertStmts.push(
        db.prepare(`INSERT OR IGNORE INTO cards (guid, deck_id, note_type, front, back, tags, cloze_count, cloze_index, is_reversed) VALUES ${placeholders}`).bind(...params)
      );
    }
    insertStmts.push(db.prepare("INSERT OR IGNORE INTO card_states (card_id, user_id) SELECT id, 1 FROM cards"));
    const batchResults = await db.batch(insertStmts);
    for (let r = 0; r < batchResults.length - 1; r++) {
      if (batchResults[r].meta && batchResults[r].meta.changes) {
        cardsCreated += batchResults[r].meta.changes;
      }
    }
    const skipped = parsedCards.length - cardsCreated;
    const { results: deckCountRows } = await db.prepare(
      `SELECT c.deck_id, COUNT(*) as total
         FROM cards c
         WHERE c.deck_id IN (${uniqueDeckNames.map(() => "?").join(",")})
         GROUP BY c.deck_id`
    ).bind(...uniqueDeckNames.map((n) => deckCache[n])).all();
    const deckCountMap = {};
    for (const row of deckCountRows) {
      deckCountMap[row.deck_id] = row.total;
    }
    const importedDecks = uniqueDeckNames.map((name) => ({
      name,
      card_count: deckCountMap[deckCache[name]] || 0
    }));
    return c.json({
      success: true,
      message: `\u30A4\u30F3\u30DD\u30FC\u30C8\u5B8C\u4E86: ${cardsCreated}\u679A\u306E\u30AB\u30FC\u30C9\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F\u3002`,
      imported_count: cardsCreated,
      skipped_count: skipped,
      total_notes_parsed: uniqueNotes.size,
      total_cards_created: cardsCreated,
      decks_created: decksCreated,
      skipped_existing: skipped,
      decks: importedDecks
    });
  } catch (err) {
    console.error("Import error:", err.stack || err);
    return c.json({ error: `\u30A4\u30F3\u30DD\u30FC\u30C8\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.get("/decks/:deckId/options", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);
  if (isNaN(deckId)) return c.json({ error: "\u7121\u52B9\u306A\u30C7\u30C3\u30ADID\u3067\u3059" }, 400);
  let options = await db.prepare(
    "SELECT max_new_cards, max_review_cards, review_order, excluded_tags FROM deck_options WHERE deck_id = ? AND user_id = ?"
  ).bind(deckId, userId).first();
  if (!options) {
    options = {
      max_new_cards: 20,
      max_review_cards: 100,
      review_order: "random",
      excluded_tags: ""
    };
  }
  return c.json(options);
});
app.post("/decks/:deckId/options", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckIdStr = c.req.param("deckId");
  const deckId = parseInt(deckIdStr, 10);
  if (isNaN(deckId)) return c.json({ error: "\u7121\u52B9\u306A\u30C7\u30C3\u30ADID\u3067\u3059" }, 400);
  const body = await c.req.json();
  const maxNew = typeof body.max_new_cards === "number" ? body.max_new_cards : 20;
  const maxRev = typeof body.max_review_cards === "number" ? body.max_review_cards : 100;
  const order = body.review_order === "sequential" ? "sequential" : "random";
  const excludedTags = typeof body.excluded_tags === "string" ? body.excluded_tags : "";
  await db.prepare(
    `INSERT INTO deck_options (deck_id, user_id, max_new_cards, max_review_cards, review_order, excluded_tags)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(deck_id, user_id) DO UPDATE SET
         max_new_cards = excluded.max_new_cards,
         max_review_cards = excluded.max_review_cards,
         review_order = excluded.review_order,
         excluded_tags = excluded.excluded_tags`
  ).bind(deckId, userId, maxNew, maxRev, order, excludedTags).run();
  return c.json({ success: true });
});
app.get("/decks/:deckId/tags", async (c) => {
  const db = c.env.DB;
  const deckId = parseInt(c.req.param("deckId"), 10);
  if (isNaN(deckId)) return c.json({ error: "\u7121\u52B9\u306A\u30C7\u30C3\u30ADID\u3067\u3059" }, 400);
  try {
    const { results: rows } = await db.prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''").bind(deckId).all();
    const tagCount = {};
    for (const row of rows) {
      const tags = row.tags.trim().split(/\s+/);
      for (const tag of tags) {
        if (tag) tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    const sorted = Object.entries(tagCount).map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
    return c.json(sorted);
  } catch (err) {
    return c.json({ error: `\u30BF\u30B0\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.get("/decks/:deckId/study", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckId = parseInt(c.req.param("deckId"), 10);
  try {
    const deckExists = await db.prepare("SELECT id FROM decks WHERE id = ?").bind(deckId).first();
    if (!deckExists) {
      return c.json({ error: "\u30C7\u30C3\u30AD\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const cards = [];
    let options = await db.prepare(
      "SELECT max_new_cards, max_review_cards, review_order, excluded_tags FROM deck_options WHERE deck_id = ? AND user_id = ?"
    ).bind(deckId, userId).first();
    if (!options) {
      options = { max_new_cards: 20, max_review_cards: 100, review_order: "random", excluded_tags: "" };
    }
    const excludedTagList = options.excluded_tags ? options.excluded_tags.trim().split(/\s+/).filter(Boolean) : [];
    let tagFilterSql = "";
    const tagFilterParams = [];
    if (excludedTagList.length > 0) {
      const { results: tagRows } = await db.prepare("SELECT tags FROM cards WHERE deck_id = ? AND tags != ''").bind(deckId).all();
      const allTags = /* @__PURE__ */ new Set();
      for (const row of tagRows) {
        for (const t of row.tags.trim().split(/\s+/)) {
          if (t) allTags.add(t);
        }
      }
      const includedTags = [...allTags].filter((t) => !excludedTagList.includes(t));
      if (includedTags.length > 0) {
        const conditions = includedTags.map(() => `INSTR(' ' || c.tags || ' ', ?) > 0`);
        tagFilterParams.push(...includedTags.map((t) => ` ${t} `));
        tagFilterSql = ` AND (${conditions.join(" OR ")})`;
      } else {
        tagFilterSql = " AND 1=0";
      }
    }
    await db.prepare(
      `INSERT OR IGNORE INTO card_states (card_id, user_id)
         SELECT c.id, ? FROM cards c LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
         WHERE c.deck_id = ? AND cs.id IS NULL`
    ).bind(userId, userId, deckId).run();
    const newBatchSize = options.max_new_cards;
    if (newBatchSize > 0) {
      const { results: newCards } = await db.prepare(
        `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
           WHERE c.deck_id = ? AND cs.status = 'new'${tagFilterSql}
           ORDER BY c.id
           LIMIT ?`
      ).bind(userId, deckId, ...tagFilterParams, newBatchSize).all();
      cards.push(...newCards);
    }
    const reviewBatchSize = options.max_review_cards;
    if (reviewBatchSize > 0) {
      const { results: reviewCards } = await db.prepare(
        `SELECT c.*, cs.ease_factor, cs.interval_days, cs.repetitions, cs.lapses, cs.status, cs.next_review_at
           FROM cards c
           JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
           WHERE c.deck_id = ? AND cs.status IN ('learning', 'review')
             AND (cs.next_review_at IS NULL OR cs.next_review_at <= ?)${tagFilterSql}
           ORDER BY cs.next_review_at
           LIMIT ?`
      ).bind(userId, deckId, nowIso, ...tagFilterParams, reviewBatchSize).all();
      cards.push(...reviewCards);
    }
    if (options.review_order === "random") {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    return c.json(
      cards.map((row) => ({
        id: row.id,
        guid: row.guid,
        deck_id: row.deck_id,
        note_type: row.note_type,
        front: row.front,
        back: row.back,
        tags: row.tags,
        cloze_count: row.cloze_count,
        cloze_index: row.cloze_index,
        is_reversed: !!row.is_reversed,
        ease_factor: row.ease_factor,
        interval_days: row.interval_days,
        repetitions: row.repetitions,
        lapses: row.lapses,
        status: row.status,
        next_review_at: row.next_review_at
      }))
    );
  } catch (err) {
    return c.json({ error: `\u5B66\u7FD2\u30AB\u30FC\u30C9\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.post("/cards/:cardId/review", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const cardId = parseInt(c.req.param("cardId"), 10);
  try {
    const { rating } = await c.req.json();
    if (!rating || rating < 1 || rating > 4) {
      return c.json({ error: "\u4E0D\u6B63\u306A\u8A55\u4FA1\u5024\u3067\u3059 (1-4)" }, 400);
    }
    await db.prepare("INSERT OR IGNORE INTO card_states (card_id, user_id) VALUES (?, ?)").bind(cardId, userId).run();
    const stateRow = await db.prepare(
      "SELECT ease_factor, interval_days, repetitions, lapses, status FROM card_states WHERE card_id = ? AND user_id = ?"
    ).bind(cardId, userId).first();
    if (!stateRow) {
      return c.json({ error: "\u30AB\u30FC\u30C9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    }
    const result = calculateNextReview(
      {
        easeFactor: stateRow.ease_factor,
        intervalDays: stateRow.interval_days,
        repetitions: stateRow.repetitions,
        lapses: stateRow.lapses,
        status: stateRow.status
      },
      rating
    );
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const nextReviewIso = result.nextReviewAt.toISOString();
    await db.batch([
      db.prepare(
        `UPDATE card_states
           SET ease_factor = ?, interval_days = ?, repetitions = ?, lapses = ?,
               next_review_at = ?, last_reviewed_at = ?, status = ?
           WHERE card_id = ? AND user_id = ?`
      ).bind(
        result.easeFactor,
        result.intervalDays,
        result.repetitions,
        result.lapses,
        nextReviewIso,
        nowIso,
        result.status,
        cardId,
        userId
      ),
      db.prepare("INSERT INTO review_logs (card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, ?)").bind(cardId, userId, rating, nowIso)
    ]);
    return c.json({
      card_id: cardId,
      rating,
      ease_factor: result.easeFactor,
      interval_days: result.intervalDays,
      repetitions: result.repetitions,
      lapses: result.lapses,
      next_review_at: nextReviewIso,
      status: result.status
    });
  } catch (err) {
    return c.json({ error: `\u5FA9\u7FD2\u767B\u9332\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
async function aggregateStats(db, userId, deckId) {
  let cardWhere = "WHERE cs.user_id = ?";
  let cardParams = [userId];
  if (deckId !== void 0) {
    cardWhere = "WHERE c.deck_id = ? AND cs.user_id = ?";
    cardParams = [deckId, userId];
  }
  const countsQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cs.status = 'new' OR cs.status IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN cs.status = 'learning' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN cs.status = 'review' THEN 1 ELSE 0 END) as review_count
    FROM cards c
    LEFT JOIN card_states cs ON c.id = cs.card_id AND cs.user_id = ?
    ${deckId !== void 0 ? "WHERE c.deck_id = ?" : ""}
  `;
  const counts = await db.prepare(countsQuery).bind(userId, ...deckId !== void 0 ? [deckId] : []).first();
  const total = counts?.total || 0;
  const newCount = counts?.new_count || 0;
  const learningCount = counts?.learning_count || 0;
  const reviewCount = counts?.review_count || 0;
  const masteredCount = Math.max(0, total - (newCount + learningCount + reviewCount));
  let reviewWhere = "WHERE user_id = ?";
  let reviewParams = [userId];
  if (deckId !== void 0) {
    reviewWhere = "WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?";
    reviewParams = [deckId, userId];
  }
  const totalReviewsResult = await db.prepare(`SELECT COUNT(*) as total FROM review_logs ${reviewWhere}`).bind(...reviewParams).first();
  const todayStart = /* @__PURE__ */ new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  let todayWhere = "WHERE reviewed_at >= ? AND user_id = ?";
  let todayParams = [todayStartIso, userId];
  if (deckId !== void 0) {
    todayWhere = "WHERE reviewed_at >= ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?) AND user_id = ?";
    todayParams = [todayStartIso, deckId, userId];
  }
  const todayReviewsResult = await db.prepare(`SELECT COUNT(*) as today FROM review_logs ${todayWhere}`).bind(...todayParams).first();
  return {
    total_cards: total,
    new_count: newCount,
    learning_count: learningCount,
    review_count: reviewCount,
    mastered_count: masteredCount,
    total_reviews: totalReviewsResult?.total || 0,
    reviews_today: todayReviewsResult?.today || 0,
    new_cards: newCount,
    learning_cards: learningCount,
    review_cards: reviewCount
  };
}
app.get("/stats", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  try {
    const mainStats = await aggregateStats(db, userId);
    const { results: decks } = await db.prepare("SELECT id, name FROM decks ORDER BY name").all();
    const deckStatsList = [];
    for (const deck of decks) {
      const counts = await getDeckCounts(db, deck.id, userId);
      const studyReady = counts.new_count + counts.learning_count + counts.review_count;
      const mastered = Math.max(0, counts.total - studyReady);
      deckStatsList.push({
        id: deck.id,
        name: deck.name,
        card_count: counts.total,
        new_count: counts.new_count,
        learning_count: counts.learning_count,
        review_count: counts.review_count,
        mastered_count: mastered
      });
    }
    return c.json({
      ...mainStats,
      decks: deckStatsList
    });
  } catch (err) {
    return c.json({ error: `\u5168\u4F53\u7D71\u8A08\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.get("/stats/deck/:deckId", async (c) => {
  const db = c.env.DB;
  const userId = getUserId(c);
  const deckId = parseInt(c.req.param("deckId"), 10);
  try {
    const deckRow = await db.prepare("SELECT name FROM decks WHERE id = ?").bind(deckId).first();
    if (!deckRow) {
      return c.json({ error: "\u30C7\u30C3\u30AD\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }, 404);
    }
    const deckStats = await aggregateStats(db, userId, deckId);
    return c.json({
      ...deckStats,
      deck_id: deckId,
      deck_name: deckRow.name
    });
  } catch (err) {
    return c.json({ error: `\u30C7\u30C3\u30AD\u5225\u7D71\u8A08\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message}` }, 500);
  }
});
app.notFound(async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const injected = html.replace(
      "</head>",
      `<script>window.__ANKI_TOKEN__ = "";<\/script></head>`
    );
    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  return response;
});
var index_default = app;
export {
  index_default as default
};
