// import {  } from "./deps.ts";

// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

// with help from https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie and rfc6265
const COOKIE_NAME_BLOCKED = /[()<>@,;:\\"/[\]?={}.]/;

// cookie octet should not have control characters, Whitespace, double quotes, comma, semicolon, and backslash
const COOKIE_OCTET_BLOCKED = /[\s",;\\]/;
const COOKIE_OCTET = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/;

const VALID_URL = /.\:./;

const TERMINATORS = ["\n", "\r", "\0"];

// from tough-cookie
function trimTerminator(str: string) {
  if (str === undefined || str === "") return str;
  for (let t = 0; t < TERMINATORS.length; t++) {
    const terminatorIdx = str.indexOf(TERMINATORS[t]);
    if (terminatorIdx !== -1) {
      str = str.substr(0, terminatorIdx);
    }
  }

  return str;
}

function isValidName(name: string | undefined) {
  if (!name) {
    return false;
  }
  if (CONTROL_CHARS.test(name) || COOKIE_NAME_BLOCKED.test(name)) {
    return false;
  }
  return true;
}

function isValidValue(val: string | undefined) {
  if (!val) {
    return false;
  }
  if (
    CONTROL_CHARS.test(val) ||
    COOKIE_OCTET_BLOCKED.test(val) ||
    !COOKIE_OCTET.test(val)
  ) {
    return false;
  }

  return true;
}

function parseDomain(url: string) {
  // we *need* to replace the leading dot to simplify usage and expectations
  let copyUrl = url.replace(/^\./, "");
  if (!copyUrl.includes("://")) {
    // the protocol does not matter
    copyUrl = "https://" + copyUrl;
  }
  return new URL(copyUrl).host;
}

export type CookieOptions = {
  name?: string;
  value?: string;
  path?: string;
  domain?: string;
  /** in milliseconds */
  expires?: number;
  /** in seconds */
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  /** used for checking against maxAge */
  creationDate?: number;
};

export class Cookie {
  // important
  name: string | undefined;
  value: string | undefined;
  path: string | undefined;
  domain: string | undefined;
  // expire
  /** in milliseconds */
  expires: number | undefined;
  /** in seconds */
  maxAge: number | undefined;
  // other
  secure = false;
  httpOnly = false;
  sameSite: "Lax" | "Strict" | "None" | undefined;
  creationDate = Date.now();

  constructor(options?: CookieOptions) {
    if (options) {
      this.name = options.name;
      this.value = options.value;
      this.path = options.path;
      this.domain = options.domain;
      this.expires = options.expires;
      this.maxAge = options.maxAge;
      this.secure = !!options.secure;
      this.httpOnly = !!options.httpOnly;
      this.sameSite = options.sameSite;

      if (options.creationDate) {
        this.creationDate = options.creationDate;
      }
    }
  }

  static from(cookieStr: string) {
    const options = {
      name: undefined,
      value: undefined,
      path: undefined,
      domain: undefined,
      expires: undefined,
      maxAge: undefined,
      secure: undefined,
      httpOnly: undefined,
      sameSite: undefined,
      creationDate: Date.now(),
    } as CookieOptions;

    const unparsed = cookieStr.slice().trim(); // copy
    const attrAndValueList = unparsed.split(";");

    // first split is the key value pair,
    // if theres no semicolon in the string, still the first element in array is key value pair
    const keyValuePair = trimTerminator(attrAndValueList.shift() || "")
      .trim()
      .split("=");
    if (keyValuePair.length !== 2) {
      return new Cookie();
    }
    if (!(isValidName(keyValuePair[0]) && isValidValue(keyValuePair[1]))) {
      return new Cookie();
    }
    options.name = keyValuePair[0];
    options.value = keyValuePair[1];

    // now get attributes
    while (attrAndValueList.length) {
      const cookieAV = attrAndValueList.shift()?.trim();
      if (!cookieAV) {
        // invalid attribute length
        continue;
      }

      const avSeperatorIndex = cookieAV.indexOf("=");
      let attrKey, attrValue;

      if (avSeperatorIndex === -1) {
        attrKey = cookieAV;
        attrValue = "";
      } else {
        attrKey = cookieAV.substr(0, avSeperatorIndex);
        attrValue = cookieAV.substr(avSeperatorIndex + 1);
      }

      attrKey = attrKey.trim().toLowerCase();

      if (attrValue) {
        attrValue = attrValue.trim();
      }

      switch (attrKey) {
        case "expires":
          if (attrValue) {
            const expires = new Date(attrValue).getTime();
            if (expires && !isNaN(expires)) {
              options.expires = expires;
            }
          }
          break;

        case "max-age":
          if (attrValue) {
            const maxAge = parseInt(attrValue, 10);
            if (!isNaN(maxAge)) {
              options.maxAge = maxAge;
            }
          }
          break;

        case "domain":
          if (attrValue) {
            const domain = parseDomain(attrValue);
            if (domain) {
              options.domain = domain;
            }
          }
          break;

        case "path":
          if (attrValue) {
            options.path = attrValue.startsWith("/")
              ? attrValue
              : "/" + attrValue;
          }
          break;

        case "secure":
          options.secure = true;
          break;

        case "httponly":
          options.httpOnly = true;
          break;

        case "samesite": {
          const lowerCasedSameSite = attrValue.toLowerCase();
          switch (lowerCasedSameSite) {
            case "strict":
              options.sameSite = "Strict";
              break;
            case "lax":
              options.sameSite = "Lax";
              break;
            case "none":
              options.sameSite = "None";
              break;
            default:
              break;
          }
          break;
        }
        // unknown attribute
        default:
          break;
      }
    }

    return new Cookie(options);
  }

  isValid(): boolean {
    return isValidName(this.name) && isValidValue(this.value);
  }

  /**
   * @param url - the url that we are checking against
   * @param redirectedTo - are we being redirecting to this url from another domain ?
   */
  canSendTo(url: string, redirectedTo = false) {
    if (!VALID_URL.test(url)) return true; // probably relative url, which is not allowed probably in deno
    if (this.sameSite === "None" && this.secure) return true;
    const host = new URL(url).host;
    if (this.domain) {
      if (this.sameSite === "Strict" || !this.sameSite) {
        if (host.endsWith(this.domain)) {
          if (!redirectedTo) {
            return true;
          }
        }
        return false;
      } else if (this.sameSite === "Lax") {
        return true;
      }
    }

    return false;
  }

  getCookieString() {
    return `${this.name || ""}=${this.value || ""}`;
  }

  setExpires(exp: Date | number) {
    if (exp instanceof Date) {
      this.expires = exp.getTime();
    } else if (typeof exp === "number" && exp >= 0) {
      this.expires = exp;
    }
  }

  isExpired() {
    if (this.maxAge !== undefined) {
      if (Date.now() - this.creationDate >= this.maxAge * 1000) {
        return true;
      }
    }
    if (this.expires !== undefined) {
      // now is past beyond the expire
      if (Date.now() - this.expires >= 0) {
        return true;
      }
    }

    return false;
  }

  toString() {
    let str = this.getCookieString();

    if (this.expires && this.expires !== Infinity) {
      "; Expires=" + (new Date(this.expires)).toUTCString();
    }

    if (this.maxAge && this.maxAge !== Infinity) {
      str += `; Max-Age=${this.maxAge}`;
    }

    if (this.domain) {
      str += `; Domain=${this.domain}`;
    }
    if (this.path) {
      str += `; Path=${this.path}`;
    }

    if (this.secure) {
      str += "; Secure";
    }
    if (this.httpOnly) {
      str += "; HttpOnly";
    }
    if (this.sameSite) {
      str += `; SameSite=${this.sameSite}`;
    }

    return str;
  }
}
