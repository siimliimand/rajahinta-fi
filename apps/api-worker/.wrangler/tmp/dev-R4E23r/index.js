var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
var __decorateParam = (index, decorator) => (target, key) => decorator(target, key, index);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// wrangler-modules-watch:wrangler:modules-watch
var init_wrangler_modules_watch = __esm({
  "wrangler-modules-watch:wrangler:modules-watch"() {
    init_modules_watch_stub();
  }
});

// ../../node_modules/.pnpm/wrangler@4.127.1_@cloudflare+workers-types@5.20260830.1/node_modules/wrangler/templates/modules-watch-stub.js
var init_modules_watch_stub = __esm({
  "../../node_modules/.pnpm/wrangler@4.127.1_@cloudflare+workers-types@5.20260830.1/node_modules/wrangler/templates/modules-watch-stub.js"() {
    init_wrangler_modules_watch();
  }
});

// ../../node_modules/.pnpm/reflect-metadata@0.2.2/node_modules/reflect-metadata/Reflect.js
var require_Reflect = __commonJS({
  "../../node_modules/.pnpm/reflect-metadata@0.2.2/node_modules/reflect-metadata/Reflect.js"() {
    init_modules_watch_stub();
    var Reflect2;
    (function(Reflect3) {
      (function(factory) {
        var root = typeof globalThis === "object" ? globalThis : typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : sloppyModeThis();
        var exporter = makeExporter(Reflect3);
        if (typeof root.Reflect !== "undefined") {
          exporter = makeExporter(root.Reflect, exporter);
        }
        factory(exporter, root);
        if (typeof root.Reflect === "undefined") {
          root.Reflect = Reflect3;
        }
        function makeExporter(target, previous) {
          return function(key, value) {
            Object.defineProperty(target, key, { configurable: true, writable: true, value });
            if (previous)
              previous(key, value);
          };
        }
        __name(makeExporter, "makeExporter");
        function functionThis() {
          try {
            return Function("return this;")();
          } catch (_) {
          }
        }
        __name(functionThis, "functionThis");
        function indirectEvalThis() {
          try {
            return (void 0, eval)("(function() { return this; })()");
          } catch (_) {
          }
        }
        __name(indirectEvalThis, "indirectEvalThis");
        function sloppyModeThis() {
          return functionThis() || indirectEvalThis();
        }
        __name(sloppyModeThis, "sloppyModeThis");
      })(function(exporter, root) {
        var hasOwn = Object.prototype.hasOwnProperty;
        var supportsSymbol = typeof Symbol === "function";
        var toPrimitiveSymbol = supportsSymbol && typeof Symbol.toPrimitive !== "undefined" ? Symbol.toPrimitive : "@@toPrimitive";
        var iteratorSymbol = supportsSymbol && typeof Symbol.iterator !== "undefined" ? Symbol.iterator : "@@iterator";
        var supportsCreate = typeof Object.create === "function";
        var supportsProto = { __proto__: [] } instanceof Array;
        var downLevel = !supportsCreate && !supportsProto;
        var HashMap = {
          // create an object in dictionary mode (a.k.a. "slow" mode in v8)
          create: supportsCreate ? function() {
            return MakeDictionary(/* @__PURE__ */ Object.create(null));
          } : supportsProto ? function() {
            return MakeDictionary({ __proto__: null });
          } : function() {
            return MakeDictionary({});
          },
          has: downLevel ? function(map, key) {
            return hasOwn.call(map, key);
          } : function(map, key) {
            return key in map;
          },
          get: downLevel ? function(map, key) {
            return hasOwn.call(map, key) ? map[key] : void 0;
          } : function(map, key) {
            return map[key];
          }
        };
        var functionPrototype = Object.getPrototypeOf(Function);
        var _Map = typeof Map === "function" && typeof Map.prototype.entries === "function" ? Map : CreateMapPolyfill();
        var _Set = typeof Set === "function" && typeof Set.prototype.entries === "function" ? Set : CreateSetPolyfill();
        var _WeakMap = typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
        var registrySymbol = supportsSymbol ? /* @__PURE__ */ Symbol.for("@reflect-metadata:registry") : void 0;
        var metadataRegistry = GetOrCreateMetadataRegistry();
        var metadataProvider = CreateMetadataProvider(metadataRegistry);
        function decorate(decorators, target, propertyKey, attributes) {
          if (!IsUndefined(propertyKey)) {
            if (!IsArray(decorators))
              throw new TypeError();
            if (!IsObject(target))
              throw new TypeError();
            if (!IsObject(attributes) && !IsUndefined(attributes) && !IsNull(attributes))
              throw new TypeError();
            if (IsNull(attributes))
              attributes = void 0;
            propertyKey = ToPropertyKey(propertyKey);
            return DecorateProperty(decorators, target, propertyKey, attributes);
          } else {
            if (!IsArray(decorators))
              throw new TypeError();
            if (!IsConstructor(target))
              throw new TypeError();
            return DecorateConstructor(decorators, target);
          }
        }
        __name(decorate, "decorate");
        exporter("decorate", decorate);
        function metadata(metadataKey, metadataValue) {
          function decorator(target, propertyKey) {
            if (!IsObject(target))
              throw new TypeError();
            if (!IsUndefined(propertyKey) && !IsPropertyKey(propertyKey))
              throw new TypeError();
            OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
          }
          __name(decorator, "decorator");
          return decorator;
        }
        __name(metadata, "metadata");
        exporter("metadata", metadata);
        function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
        }
        __name(defineMetadata, "defineMetadata");
        exporter("defineMetadata", defineMetadata);
        function hasMetadata(metadataKey, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryHasMetadata(metadataKey, target, propertyKey);
        }
        __name(hasMetadata, "hasMetadata");
        exporter("hasMetadata", hasMetadata);
        function hasOwnMetadata(metadataKey, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryHasOwnMetadata(metadataKey, target, propertyKey);
        }
        __name(hasOwnMetadata, "hasOwnMetadata");
        exporter("hasOwnMetadata", hasOwnMetadata);
        function getMetadata(metadataKey, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryGetMetadata(metadataKey, target, propertyKey);
        }
        __name(getMetadata, "getMetadata");
        exporter("getMetadata", getMetadata);
        function getOwnMetadata(metadataKey, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryGetOwnMetadata(metadataKey, target, propertyKey);
        }
        __name(getOwnMetadata, "getOwnMetadata");
        exporter("getOwnMetadata", getOwnMetadata);
        function getMetadataKeys(target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryMetadataKeys(target, propertyKey);
        }
        __name(getMetadataKeys, "getMetadataKeys");
        exporter("getMetadataKeys", getMetadataKeys);
        function getOwnMetadataKeys(target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          return OrdinaryOwnMetadataKeys(target, propertyKey);
        }
        __name(getOwnMetadataKeys, "getOwnMetadataKeys");
        exporter("getOwnMetadataKeys", getOwnMetadataKeys);
        function deleteMetadata(metadataKey, target, propertyKey) {
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          if (!IsObject(target))
            throw new TypeError();
          if (!IsUndefined(propertyKey))
            propertyKey = ToPropertyKey(propertyKey);
          var provider = GetMetadataProvider(
            target,
            propertyKey,
            /*Create*/
            false
          );
          if (IsUndefined(provider))
            return false;
          return provider.OrdinaryDeleteMetadata(metadataKey, target, propertyKey);
        }
        __name(deleteMetadata, "deleteMetadata");
        exporter("deleteMetadata", deleteMetadata);
        function DecorateConstructor(decorators, target) {
          for (var i = decorators.length - 1; i >= 0; --i) {
            var decorator = decorators[i];
            var decorated = decorator(target);
            if (!IsUndefined(decorated) && !IsNull(decorated)) {
              if (!IsConstructor(decorated))
                throw new TypeError();
              target = decorated;
            }
          }
          return target;
        }
        __name(DecorateConstructor, "DecorateConstructor");
        function DecorateProperty(decorators, target, propertyKey, descriptor) {
          for (var i = decorators.length - 1; i >= 0; --i) {
            var decorator = decorators[i];
            var decorated = decorator(target, propertyKey, descriptor);
            if (!IsUndefined(decorated) && !IsNull(decorated)) {
              if (!IsObject(decorated))
                throw new TypeError();
              descriptor = decorated;
            }
          }
          return descriptor;
        }
        __name(DecorateProperty, "DecorateProperty");
        function OrdinaryHasMetadata(MetadataKey, O, P) {
          var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
          if (hasOwn2)
            return true;
          var parent = OrdinaryGetPrototypeOf(O);
          if (!IsNull(parent))
            return OrdinaryHasMetadata(MetadataKey, parent, P);
          return false;
        }
        __name(OrdinaryHasMetadata, "OrdinaryHasMetadata");
        function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
          var provider = GetMetadataProvider(
            O,
            P,
            /*Create*/
            false
          );
          if (IsUndefined(provider))
            return false;
          return ToBoolean(provider.OrdinaryHasOwnMetadata(MetadataKey, O, P));
        }
        __name(OrdinaryHasOwnMetadata, "OrdinaryHasOwnMetadata");
        function OrdinaryGetMetadata(MetadataKey, O, P) {
          var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
          if (hasOwn2)
            return OrdinaryGetOwnMetadata(MetadataKey, O, P);
          var parent = OrdinaryGetPrototypeOf(O);
          if (!IsNull(parent))
            return OrdinaryGetMetadata(MetadataKey, parent, P);
          return void 0;
        }
        __name(OrdinaryGetMetadata, "OrdinaryGetMetadata");
        function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
          var provider = GetMetadataProvider(
            O,
            P,
            /*Create*/
            false
          );
          if (IsUndefined(provider))
            return;
          return provider.OrdinaryGetOwnMetadata(MetadataKey, O, P);
        }
        __name(OrdinaryGetOwnMetadata, "OrdinaryGetOwnMetadata");
        function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
          var provider = GetMetadataProvider(
            O,
            P,
            /*Create*/
            true
          );
          provider.OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P);
        }
        __name(OrdinaryDefineOwnMetadata, "OrdinaryDefineOwnMetadata");
        function OrdinaryMetadataKeys(O, P) {
          var ownKeys = OrdinaryOwnMetadataKeys(O, P);
          var parent = OrdinaryGetPrototypeOf(O);
          if (parent === null)
            return ownKeys;
          var parentKeys = OrdinaryMetadataKeys(parent, P);
          if (parentKeys.length <= 0)
            return ownKeys;
          if (ownKeys.length <= 0)
            return parentKeys;
          var set = new _Set();
          var keys = [];
          for (var _i = 0, ownKeys_1 = ownKeys; _i < ownKeys_1.length; _i++) {
            var key = ownKeys_1[_i];
            var hasKey = set.has(key);
            if (!hasKey) {
              set.add(key);
              keys.push(key);
            }
          }
          for (var _a = 0, parentKeys_1 = parentKeys; _a < parentKeys_1.length; _a++) {
            var key = parentKeys_1[_a];
            var hasKey = set.has(key);
            if (!hasKey) {
              set.add(key);
              keys.push(key);
            }
          }
          return keys;
        }
        __name(OrdinaryMetadataKeys, "OrdinaryMetadataKeys");
        function OrdinaryOwnMetadataKeys(O, P) {
          var provider = GetMetadataProvider(
            O,
            P,
            /*create*/
            false
          );
          if (!provider) {
            return [];
          }
          return provider.OrdinaryOwnMetadataKeys(O, P);
        }
        __name(OrdinaryOwnMetadataKeys, "OrdinaryOwnMetadataKeys");
        function Type(x) {
          if (x === null)
            return 1;
          switch (typeof x) {
            case "undefined":
              return 0;
            case "boolean":
              return 2;
            case "string":
              return 3;
            case "symbol":
              return 4;
            case "number":
              return 5;
            case "object":
              return x === null ? 1 : 6;
            default:
              return 6;
          }
        }
        __name(Type, "Type");
        function IsUndefined(x) {
          return x === void 0;
        }
        __name(IsUndefined, "IsUndefined");
        function IsNull(x) {
          return x === null;
        }
        __name(IsNull, "IsNull");
        function IsSymbol(x) {
          return typeof x === "symbol";
        }
        __name(IsSymbol, "IsSymbol");
        function IsObject(x) {
          return typeof x === "object" ? x !== null : typeof x === "function";
        }
        __name(IsObject, "IsObject");
        function ToPrimitive(input, PreferredType) {
          switch (Type(input)) {
            case 0:
              return input;
            case 1:
              return input;
            case 2:
              return input;
            case 3:
              return input;
            case 4:
              return input;
            case 5:
              return input;
          }
          var hint = PreferredType === 3 ? "string" : PreferredType === 5 ? "number" : "default";
          var exoticToPrim = GetMethod(input, toPrimitiveSymbol);
          if (exoticToPrim !== void 0) {
            var result = exoticToPrim.call(input, hint);
            if (IsObject(result))
              throw new TypeError();
            return result;
          }
          return OrdinaryToPrimitive(input, hint === "default" ? "number" : hint);
        }
        __name(ToPrimitive, "ToPrimitive");
        function OrdinaryToPrimitive(O, hint) {
          if (hint === "string") {
            var toString_1 = O.toString;
            if (IsCallable(toString_1)) {
              var result = toString_1.call(O);
              if (!IsObject(result))
                return result;
            }
            var valueOf = O.valueOf;
            if (IsCallable(valueOf)) {
              var result = valueOf.call(O);
              if (!IsObject(result))
                return result;
            }
          } else {
            var valueOf = O.valueOf;
            if (IsCallable(valueOf)) {
              var result = valueOf.call(O);
              if (!IsObject(result))
                return result;
            }
            var toString_2 = O.toString;
            if (IsCallable(toString_2)) {
              var result = toString_2.call(O);
              if (!IsObject(result))
                return result;
            }
          }
          throw new TypeError();
        }
        __name(OrdinaryToPrimitive, "OrdinaryToPrimitive");
        function ToBoolean(argument) {
          return !!argument;
        }
        __name(ToBoolean, "ToBoolean");
        function ToString(argument) {
          return "" + argument;
        }
        __name(ToString, "ToString");
        function ToPropertyKey(argument) {
          var key = ToPrimitive(
            argument,
            3
            /* String */
          );
          if (IsSymbol(key))
            return key;
          return ToString(key);
        }
        __name(ToPropertyKey, "ToPropertyKey");
        function IsArray(argument) {
          return Array.isArray ? Array.isArray(argument) : argument instanceof Object ? argument instanceof Array : Object.prototype.toString.call(argument) === "[object Array]";
        }
        __name(IsArray, "IsArray");
        function IsCallable(argument) {
          return typeof argument === "function";
        }
        __name(IsCallable, "IsCallable");
        function IsConstructor(argument) {
          return typeof argument === "function";
        }
        __name(IsConstructor, "IsConstructor");
        function IsPropertyKey(argument) {
          switch (Type(argument)) {
            case 3:
              return true;
            case 4:
              return true;
            default:
              return false;
          }
        }
        __name(IsPropertyKey, "IsPropertyKey");
        function SameValueZero(x, y) {
          return x === y || x !== x && y !== y;
        }
        __name(SameValueZero, "SameValueZero");
        function GetMethod(V, P) {
          var func = V[P];
          if (func === void 0 || func === null)
            return void 0;
          if (!IsCallable(func))
            throw new TypeError();
          return func;
        }
        __name(GetMethod, "GetMethod");
        function GetIterator(obj) {
          var method = GetMethod(obj, iteratorSymbol);
          if (!IsCallable(method))
            throw new TypeError();
          var iterator = method.call(obj);
          if (!IsObject(iterator))
            throw new TypeError();
          return iterator;
        }
        __name(GetIterator, "GetIterator");
        function IteratorValue(iterResult) {
          return iterResult.value;
        }
        __name(IteratorValue, "IteratorValue");
        function IteratorStep(iterator) {
          var result = iterator.next();
          return result.done ? false : result;
        }
        __name(IteratorStep, "IteratorStep");
        function IteratorClose(iterator) {
          var f = iterator["return"];
          if (f)
            f.call(iterator);
        }
        __name(IteratorClose, "IteratorClose");
        function OrdinaryGetPrototypeOf(O) {
          var proto = Object.getPrototypeOf(O);
          if (typeof O !== "function" || O === functionPrototype)
            return proto;
          if (proto !== functionPrototype)
            return proto;
          var prototype = O.prototype;
          var prototypeProto = prototype && Object.getPrototypeOf(prototype);
          if (prototypeProto == null || prototypeProto === Object.prototype)
            return proto;
          var constructor = prototypeProto.constructor;
          if (typeof constructor !== "function")
            return proto;
          if (constructor === O)
            return proto;
          return constructor;
        }
        __name(OrdinaryGetPrototypeOf, "OrdinaryGetPrototypeOf");
        function CreateMetadataRegistry() {
          var fallback;
          if (!IsUndefined(registrySymbol) && typeof root.Reflect !== "undefined" && !(registrySymbol in root.Reflect) && typeof root.Reflect.defineMetadata === "function") {
            fallback = CreateFallbackProvider(root.Reflect);
          }
          var first;
          var second;
          var rest;
          var targetProviderMap = new _WeakMap();
          var registry = {
            registerProvider,
            getProvider,
            setProvider
          };
          return registry;
          function registerProvider(provider) {
            if (!Object.isExtensible(registry)) {
              throw new Error("Cannot add provider to a frozen registry.");
            }
            switch (true) {
              case fallback === provider:
                break;
              case IsUndefined(first):
                first = provider;
                break;
              case first === provider:
                break;
              case IsUndefined(second):
                second = provider;
                break;
              case second === provider:
                break;
              default:
                if (rest === void 0)
                  rest = new _Set();
                rest.add(provider);
                break;
            }
          }
          __name(registerProvider, "registerProvider");
          function getProviderNoCache(O, P) {
            if (!IsUndefined(first)) {
              if (first.isProviderFor(O, P))
                return first;
              if (!IsUndefined(second)) {
                if (second.isProviderFor(O, P))
                  return first;
                if (!IsUndefined(rest)) {
                  var iterator = GetIterator(rest);
                  while (true) {
                    var next = IteratorStep(iterator);
                    if (!next) {
                      return void 0;
                    }
                    var provider = IteratorValue(next);
                    if (provider.isProviderFor(O, P)) {
                      IteratorClose(iterator);
                      return provider;
                    }
                  }
                }
              }
            }
            if (!IsUndefined(fallback) && fallback.isProviderFor(O, P)) {
              return fallback;
            }
            return void 0;
          }
          __name(getProviderNoCache, "getProviderNoCache");
          function getProvider(O, P) {
            var providerMap = targetProviderMap.get(O);
            var provider;
            if (!IsUndefined(providerMap)) {
              provider = providerMap.get(P);
            }
            if (!IsUndefined(provider)) {
              return provider;
            }
            provider = getProviderNoCache(O, P);
            if (!IsUndefined(provider)) {
              if (IsUndefined(providerMap)) {
                providerMap = new _Map();
                targetProviderMap.set(O, providerMap);
              }
              providerMap.set(P, provider);
            }
            return provider;
          }
          __name(getProvider, "getProvider");
          function hasProvider(provider) {
            if (IsUndefined(provider))
              throw new TypeError();
            return first === provider || second === provider || !IsUndefined(rest) && rest.has(provider);
          }
          __name(hasProvider, "hasProvider");
          function setProvider(O, P, provider) {
            if (!hasProvider(provider)) {
              throw new Error("Metadata provider not registered.");
            }
            var existingProvider = getProvider(O, P);
            if (existingProvider !== provider) {
              if (!IsUndefined(existingProvider)) {
                return false;
              }
              var providerMap = targetProviderMap.get(O);
              if (IsUndefined(providerMap)) {
                providerMap = new _Map();
                targetProviderMap.set(O, providerMap);
              }
              providerMap.set(P, provider);
            }
            return true;
          }
          __name(setProvider, "setProvider");
        }
        __name(CreateMetadataRegistry, "CreateMetadataRegistry");
        function GetOrCreateMetadataRegistry() {
          var metadataRegistry2;
          if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
            metadataRegistry2 = root.Reflect[registrySymbol];
          }
          if (IsUndefined(metadataRegistry2)) {
            metadataRegistry2 = CreateMetadataRegistry();
          }
          if (!IsUndefined(registrySymbol) && IsObject(root.Reflect) && Object.isExtensible(root.Reflect)) {
            Object.defineProperty(root.Reflect, registrySymbol, {
              enumerable: false,
              configurable: false,
              writable: false,
              value: metadataRegistry2
            });
          }
          return metadataRegistry2;
        }
        __name(GetOrCreateMetadataRegistry, "GetOrCreateMetadataRegistry");
        function CreateMetadataProvider(registry) {
          var metadata2 = new _WeakMap();
          var provider = {
            isProviderFor: /* @__PURE__ */ __name(function(O, P) {
              var targetMetadata = metadata2.get(O);
              if (IsUndefined(targetMetadata))
                return false;
              return targetMetadata.has(P);
            }, "isProviderFor"),
            OrdinaryDefineOwnMetadata: OrdinaryDefineOwnMetadata2,
            OrdinaryHasOwnMetadata: OrdinaryHasOwnMetadata2,
            OrdinaryGetOwnMetadata: OrdinaryGetOwnMetadata2,
            OrdinaryOwnMetadataKeys: OrdinaryOwnMetadataKeys2,
            OrdinaryDeleteMetadata
          };
          metadataRegistry.registerProvider(provider);
          return provider;
          function GetOrCreateMetadataMap(O, P, Create) {
            var targetMetadata = metadata2.get(O);
            var createdTargetMetadata = false;
            if (IsUndefined(targetMetadata)) {
              if (!Create)
                return void 0;
              targetMetadata = new _Map();
              metadata2.set(O, targetMetadata);
              createdTargetMetadata = true;
            }
            var metadataMap = targetMetadata.get(P);
            if (IsUndefined(metadataMap)) {
              if (!Create)
                return void 0;
              metadataMap = new _Map();
              targetMetadata.set(P, metadataMap);
              if (!registry.setProvider(O, P, provider)) {
                targetMetadata.delete(P);
                if (createdTargetMetadata) {
                  metadata2.delete(O);
                }
                throw new Error("Wrong provider for target.");
              }
            }
            return metadataMap;
          }
          __name(GetOrCreateMetadataMap, "GetOrCreateMetadataMap");
          function OrdinaryHasOwnMetadata2(MetadataKey, O, P) {
            var metadataMap = GetOrCreateMetadataMap(
              O,
              P,
              /*Create*/
              false
            );
            if (IsUndefined(metadataMap))
              return false;
            return ToBoolean(metadataMap.has(MetadataKey));
          }
          __name(OrdinaryHasOwnMetadata2, "OrdinaryHasOwnMetadata");
          function OrdinaryGetOwnMetadata2(MetadataKey, O, P) {
            var metadataMap = GetOrCreateMetadataMap(
              O,
              P,
              /*Create*/
              false
            );
            if (IsUndefined(metadataMap))
              return void 0;
            return metadataMap.get(MetadataKey);
          }
          __name(OrdinaryGetOwnMetadata2, "OrdinaryGetOwnMetadata");
          function OrdinaryDefineOwnMetadata2(MetadataKey, MetadataValue, O, P) {
            var metadataMap = GetOrCreateMetadataMap(
              O,
              P,
              /*Create*/
              true
            );
            metadataMap.set(MetadataKey, MetadataValue);
          }
          __name(OrdinaryDefineOwnMetadata2, "OrdinaryDefineOwnMetadata");
          function OrdinaryOwnMetadataKeys2(O, P) {
            var keys = [];
            var metadataMap = GetOrCreateMetadataMap(
              O,
              P,
              /*Create*/
              false
            );
            if (IsUndefined(metadataMap))
              return keys;
            var keysObj = metadataMap.keys();
            var iterator = GetIterator(keysObj);
            var k = 0;
            while (true) {
              var next = IteratorStep(iterator);
              if (!next) {
                keys.length = k;
                return keys;
              }
              var nextValue = IteratorValue(next);
              try {
                keys[k] = nextValue;
              } catch (e) {
                try {
                  IteratorClose(iterator);
                } finally {
                  throw e;
                }
              }
              k++;
            }
          }
          __name(OrdinaryOwnMetadataKeys2, "OrdinaryOwnMetadataKeys");
          function OrdinaryDeleteMetadata(MetadataKey, O, P) {
            var metadataMap = GetOrCreateMetadataMap(
              O,
              P,
              /*Create*/
              false
            );
            if (IsUndefined(metadataMap))
              return false;
            if (!metadataMap.delete(MetadataKey))
              return false;
            if (metadataMap.size === 0) {
              var targetMetadata = metadata2.get(O);
              if (!IsUndefined(targetMetadata)) {
                targetMetadata.delete(P);
                if (targetMetadata.size === 0) {
                  metadata2.delete(targetMetadata);
                }
              }
            }
            return true;
          }
          __name(OrdinaryDeleteMetadata, "OrdinaryDeleteMetadata");
        }
        __name(CreateMetadataProvider, "CreateMetadataProvider");
        function CreateFallbackProvider(reflect) {
          var defineMetadata2 = reflect.defineMetadata, hasOwnMetadata2 = reflect.hasOwnMetadata, getOwnMetadata2 = reflect.getOwnMetadata, getOwnMetadataKeys2 = reflect.getOwnMetadataKeys, deleteMetadata2 = reflect.deleteMetadata;
          var metadataOwner = new _WeakMap();
          var provider = {
            isProviderFor: /* @__PURE__ */ __name(function(O, P) {
              var metadataPropertySet = metadataOwner.get(O);
              if (!IsUndefined(metadataPropertySet) && metadataPropertySet.has(P)) {
                return true;
              }
              if (getOwnMetadataKeys2(O, P).length) {
                if (IsUndefined(metadataPropertySet)) {
                  metadataPropertySet = new _Set();
                  metadataOwner.set(O, metadataPropertySet);
                }
                metadataPropertySet.add(P);
                return true;
              }
              return false;
            }, "isProviderFor"),
            OrdinaryDefineOwnMetadata: defineMetadata2,
            OrdinaryHasOwnMetadata: hasOwnMetadata2,
            OrdinaryGetOwnMetadata: getOwnMetadata2,
            OrdinaryOwnMetadataKeys: getOwnMetadataKeys2,
            OrdinaryDeleteMetadata: deleteMetadata2
          };
          return provider;
        }
        __name(CreateFallbackProvider, "CreateFallbackProvider");
        function GetMetadataProvider(O, P, Create) {
          var registeredProvider = metadataRegistry.getProvider(O, P);
          if (!IsUndefined(registeredProvider)) {
            return registeredProvider;
          }
          if (Create) {
            if (metadataRegistry.setProvider(O, P, metadataProvider)) {
              return metadataProvider;
            }
            throw new Error("Illegal state.");
          }
          return void 0;
        }
        __name(GetMetadataProvider, "GetMetadataProvider");
        function CreateMapPolyfill() {
          var cacheSentinel = {};
          var arraySentinel = [];
          var MapIterator = (
            /** @class */
            (function() {
              function MapIterator2(keys, values, selector) {
                this._index = 0;
                this._keys = keys;
                this._values = values;
                this._selector = selector;
              }
              __name(MapIterator2, "MapIterator");
              MapIterator2.prototype["@@iterator"] = function() {
                return this;
              };
              MapIterator2.prototype[iteratorSymbol] = function() {
                return this;
              };
              MapIterator2.prototype.next = function() {
                var index = this._index;
                if (index >= 0 && index < this._keys.length) {
                  var result = this._selector(this._keys[index], this._values[index]);
                  if (index + 1 >= this._keys.length) {
                    this._index = -1;
                    this._keys = arraySentinel;
                    this._values = arraySentinel;
                  } else {
                    this._index++;
                  }
                  return { value: result, done: false };
                }
                return { value: void 0, done: true };
              };
              MapIterator2.prototype.throw = function(error) {
                if (this._index >= 0) {
                  this._index = -1;
                  this._keys = arraySentinel;
                  this._values = arraySentinel;
                }
                throw error;
              };
              MapIterator2.prototype.return = function(value) {
                if (this._index >= 0) {
                  this._index = -1;
                  this._keys = arraySentinel;
                  this._values = arraySentinel;
                }
                return { value, done: true };
              };
              return MapIterator2;
            })()
          );
          var Map2 = (
            /** @class */
            (function() {
              function Map3() {
                this._keys = [];
                this._values = [];
                this._cacheKey = cacheSentinel;
                this._cacheIndex = -2;
              }
              __name(Map3, "Map");
              Object.defineProperty(Map3.prototype, "size", {
                get: /* @__PURE__ */ __name(function() {
                  return this._keys.length;
                }, "get"),
                enumerable: true,
                configurable: true
              });
              Map3.prototype.has = function(key) {
                return this._find(
                  key,
                  /*insert*/
                  false
                ) >= 0;
              };
              Map3.prototype.get = function(key) {
                var index = this._find(
                  key,
                  /*insert*/
                  false
                );
                return index >= 0 ? this._values[index] : void 0;
              };
              Map3.prototype.set = function(key, value) {
                var index = this._find(
                  key,
                  /*insert*/
                  true
                );
                this._values[index] = value;
                return this;
              };
              Map3.prototype.delete = function(key) {
                var index = this._find(
                  key,
                  /*insert*/
                  false
                );
                if (index >= 0) {
                  var size = this._keys.length;
                  for (var i = index + 1; i < size; i++) {
                    this._keys[i - 1] = this._keys[i];
                    this._values[i - 1] = this._values[i];
                  }
                  this._keys.length--;
                  this._values.length--;
                  if (SameValueZero(key, this._cacheKey)) {
                    this._cacheKey = cacheSentinel;
                    this._cacheIndex = -2;
                  }
                  return true;
                }
                return false;
              };
              Map3.prototype.clear = function() {
                this._keys.length = 0;
                this._values.length = 0;
                this._cacheKey = cacheSentinel;
                this._cacheIndex = -2;
              };
              Map3.prototype.keys = function() {
                return new MapIterator(this._keys, this._values, getKey);
              };
              Map3.prototype.values = function() {
                return new MapIterator(this._keys, this._values, getValue);
              };
              Map3.prototype.entries = function() {
                return new MapIterator(this._keys, this._values, getEntry);
              };
              Map3.prototype["@@iterator"] = function() {
                return this.entries();
              };
              Map3.prototype[iteratorSymbol] = function() {
                return this.entries();
              };
              Map3.prototype._find = function(key, insert) {
                if (!SameValueZero(this._cacheKey, key)) {
                  this._cacheIndex = -1;
                  for (var i = 0; i < this._keys.length; i++) {
                    if (SameValueZero(this._keys[i], key)) {
                      this._cacheIndex = i;
                      break;
                    }
                  }
                }
                if (this._cacheIndex < 0 && insert) {
                  this._cacheIndex = this._keys.length;
                  this._keys.push(key);
                  this._values.push(void 0);
                }
                return this._cacheIndex;
              };
              return Map3;
            })()
          );
          return Map2;
          function getKey(key, _) {
            return key;
          }
          __name(getKey, "getKey");
          function getValue(_, value) {
            return value;
          }
          __name(getValue, "getValue");
          function getEntry(key, value) {
            return [key, value];
          }
          __name(getEntry, "getEntry");
        }
        __name(CreateMapPolyfill, "CreateMapPolyfill");
        function CreateSetPolyfill() {
          var Set2 = (
            /** @class */
            (function() {
              function Set3() {
                this._map = new _Map();
              }
              __name(Set3, "Set");
              Object.defineProperty(Set3.prototype, "size", {
                get: /* @__PURE__ */ __name(function() {
                  return this._map.size;
                }, "get"),
                enumerable: true,
                configurable: true
              });
              Set3.prototype.has = function(value) {
                return this._map.has(value);
              };
              Set3.prototype.add = function(value) {
                return this._map.set(value, value), this;
              };
              Set3.prototype.delete = function(value) {
                return this._map.delete(value);
              };
              Set3.prototype.clear = function() {
                this._map.clear();
              };
              Set3.prototype.keys = function() {
                return this._map.keys();
              };
              Set3.prototype.values = function() {
                return this._map.keys();
              };
              Set3.prototype.entries = function() {
                return this._map.entries();
              };
              Set3.prototype["@@iterator"] = function() {
                return this.keys();
              };
              Set3.prototype[iteratorSymbol] = function() {
                return this.keys();
              };
              return Set3;
            })()
          );
          return Set2;
        }
        __name(CreateSetPolyfill, "CreateSetPolyfill");
        function CreateWeakMapPolyfill() {
          var UUID_SIZE = 16;
          var keys = HashMap.create();
          var rootKey = CreateUniqueKey();
          return (
            /** @class */
            (function() {
              function WeakMap2() {
                this._key = CreateUniqueKey();
              }
              __name(WeakMap2, "WeakMap");
              WeakMap2.prototype.has = function(target) {
                var table = GetOrCreateWeakMapTable(
                  target,
                  /*create*/
                  false
                );
                return table !== void 0 ? HashMap.has(table, this._key) : false;
              };
              WeakMap2.prototype.get = function(target) {
                var table = GetOrCreateWeakMapTable(
                  target,
                  /*create*/
                  false
                );
                return table !== void 0 ? HashMap.get(table, this._key) : void 0;
              };
              WeakMap2.prototype.set = function(target, value) {
                var table = GetOrCreateWeakMapTable(
                  target,
                  /*create*/
                  true
                );
                table[this._key] = value;
                return this;
              };
              WeakMap2.prototype.delete = function(target) {
                var table = GetOrCreateWeakMapTable(
                  target,
                  /*create*/
                  false
                );
                return table !== void 0 ? delete table[this._key] : false;
              };
              WeakMap2.prototype.clear = function() {
                this._key = CreateUniqueKey();
              };
              return WeakMap2;
            })()
          );
          function CreateUniqueKey() {
            var key;
            do
              key = "@@WeakMap@@" + CreateUUID();
            while (HashMap.has(keys, key));
            keys[key] = true;
            return key;
          }
          __name(CreateUniqueKey, "CreateUniqueKey");
          function GetOrCreateWeakMapTable(target, create) {
            if (!hasOwn.call(target, rootKey)) {
              if (!create)
                return void 0;
              Object.defineProperty(target, rootKey, { value: HashMap.create() });
            }
            return target[rootKey];
          }
          __name(GetOrCreateWeakMapTable, "GetOrCreateWeakMapTable");
          function FillRandomBytes(buffer, size) {
            for (var i = 0; i < size; ++i)
              buffer[i] = Math.random() * 255 | 0;
            return buffer;
          }
          __name(FillRandomBytes, "FillRandomBytes");
          function GenRandomBytes(size) {
            if (typeof Uint8Array === "function") {
              var array = new Uint8Array(size);
              if (typeof crypto !== "undefined") {
                crypto.getRandomValues(array);
              } else if (typeof msCrypto !== "undefined") {
                msCrypto.getRandomValues(array);
              } else {
                FillRandomBytes(array, size);
              }
              return array;
            }
            return FillRandomBytes(new Array(size), size);
          }
          __name(GenRandomBytes, "GenRandomBytes");
          function CreateUUID() {
            var data = GenRandomBytes(UUID_SIZE);
            data[6] = data[6] & 79 | 64;
            data[8] = data[8] & 191 | 128;
            var result = "";
            for (var offset = 0; offset < UUID_SIZE; ++offset) {
              var byte = data[offset];
              if (offset === 4 || offset === 6 || offset === 8)
                result += "-";
              if (byte < 16)
                result += "0";
              result += byte.toString(16).toLowerCase();
            }
            return result;
          }
          __name(CreateUUID, "CreateUUID");
        }
        __name(CreateWeakMapPolyfill, "CreateWeakMapPolyfill");
        function MakeDictionary(obj) {
          obj.__ = void 0;
          delete obj.__;
          return obj;
        }
        __name(MakeDictionary, "MakeDictionary");
      });
    })(Reflect2 || (Reflect2 = {}));
  }
});

// .wrangler/tmp/bundle-Mi9oms/middleware-loader.entry.ts
init_modules_watch_stub();

// .wrangler/tmp/bundle-Mi9oms/middleware-insertion-facade.js
init_modules_watch_stub();

// src/index.ts
init_modules_watch_stub();
var import_reflect_metadata = __toESM(require_Reflect(), 1);

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/hono.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/hono-base.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/compose.js
init_modules_watch_stub();
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
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
    __name(dispatch, "dispatch");
  };
}, "compose");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/context.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/request.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/http-exception.js
init_modules_watch_stub();
var HTTPException = class extends Error {
  static {
    __name(this, "HTTPException");
  }
  res;
  status;
  /**
   * Creates an instance of `HTTPException`.
   * @param status - HTTP status code for the exception. Defaults to 500.
   * @param options - Additional options for the exception.
   */
  constructor(status = 500, options) {
    super(options?.message, { cause: options?.cause });
    this.res = options?.res;
    this.status = status;
  }
  /**
   * Returns the response object associated with the exception.
   * If a response object is not provided, a new response is created with the error message and status code.
   * @returns The response object.
   */
  getResponse() {
    if (this.res) {
      const newResponse = new Response(this.res.body, {
        status: this.status,
        headers: this.res.headers
      });
      return newResponse;
    }
    return new Response(this.message, {
      status: this.status
    });
  }
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/request/constants.js
init_modules_watch_stub();
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/body.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/buffer.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/crypto.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  const response = new Response(arrayBuffer, {
    headers: {
      // Normalize the media type (case-insensitive) while keeping parameters like the boundary
      "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase())
    }
  });
  return response.formData();
}, "bufferToFormData");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/body.js
var MAX_NESTING_DEPTH = 32;
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const contentType = headers.get("Content-Type");
  const mediaType = contentType?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) {
    return convertFormDataToBodyData(
      await request.bodyCache.formData,
      options
    );
  }
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) {
    request.bodyCache.formData = formDataPromise;
  }
  const formData = await formDataPromise;
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
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
        handleParsingNestedValues(form, key, value, nestingState);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
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
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".", MAX_NESTING_DEPTH + 2);
  if (keys.length > MAX_NESTING_DEPTH + 1) {
    throwNestingLimitExceeded();
  }
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) {
          throwNestingLimitExceeded();
        }
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");
var throwNestingLimitExceeded = /* @__PURE__ */ __name(() => {
  throw new Error("Nesting limit exceeded");
}, "throwNestingLimitExceeded");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/url.js
init_modules_watch_stub();
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
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
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
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
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
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
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
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
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
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
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str, "tryDecodeURIComponent");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return tryDecodeURIComponent(value);
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
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
  const results = /* @__PURE__ */ Object.create(null);
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
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/request.js
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
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
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = tryDecodeURIComponent(value);
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
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    for (const anyCachedKey in bodyCache) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
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
    ;
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
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

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/html.js
init_modules_watch_stub();
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
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
}, "resolveCallback");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
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
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
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
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
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
   *   // Append multiple headers using the append option (e.g. Vary)
   *   c.header('Vary', 'Accept-Encoding', { append: true })
   *   c.header('Vary', 'User-Agent', { append: true })
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = /* @__PURE__ */ __name((name, value, options) => {
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
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
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
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
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
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
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
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) {
        if (key === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) {
          if (++count > 1 || typeof headers[k] !== "string") {
            responseHeaders = new Headers();
            break;
          }
        }
      }
      if (responseHeaders) {
        for (const k in headers) {
          const v = headers[k];
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
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
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
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
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
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
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
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
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
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
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
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router.js
init_modules_watch_stub();
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch", "query"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/constants.js
init_modules_watch_stub();
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class _Hono {
  static {
    __name(this, "_Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
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
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
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
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
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
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
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
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
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
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
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
   * @param {Env} env - env Object
   * @param {ExecutionContext} executionCtx - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
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
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
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
  }, "request");
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
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/router.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/utils.js
init_modules_watch_stub();
var createNullObject = /* @__PURE__ */ __name(() => /* @__PURE__ */ Object.create(null), "createNullObject");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/matcher.js
init_modules_watch_stub();
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
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
  }), "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/node.js
init_modules_watch_stub();
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
    return b === TAIL_WILDCARD_REG_EXP_STR ? -1 : 1;
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
__name(compareKey, "compareKey");
var Node = class _Node {
  static {
    __name(this, "_Node");
  }
  // handler index of a dynamic path, or -1 for a static path terminal
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : null : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
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
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) {
            throw PATH_ERROR;
          }
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ONLY_WILDCARD_REG_EXP_STR && regexpStr !== TAIL_WILDCARD_REG_EXP_STR) {
            for (const k in node.#children) {
              if (
                // a single-char pattern coexists with single-char literals as a literal does
                (regexpStr.length > 1 || k.length > 1) && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
              ) {
                throw PATH_ERROR;
              }
            }
          }
          nextNode = node.#children[regexpStr] = new _Node();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) {
            if (k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR) {
              throw PATH_ERROR;
            }
          }
          nextNode = node.#children[token] = new _Node();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) {
      throw PATH_ERROR;
    }
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) {
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

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/trie.js
init_modules_watch_stub();
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  // dynamic path -> [handler index, param assoc]; static paths are not registered
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
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
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
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

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    `^${path.replace(
      /\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g,
      (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ONLY_WILDCARD_REG_EXP_STR : `/:${LABEL_REG_EXP_STR}`
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: createNullObject() };
    this.#routes = { [METHOD_NAME_ALL]: createNullObject() };
    this.#tries = { [METHOD_NAME_ALL]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap[METHOD_NAME_ALL]) {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*") {
      path = "*";
    }
    const methods = method === METHOD_NAME_ALL ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods) {
        if (!middleware[m][path]) {
          this.#insertPath(m, path);
          middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        }
      }
      for (const handlerMap of [middleware, routes]) {
        for (const m of methods) {
          for (const p in handlerMap[m]) {
            re.test(p) && handlerMap[m][p].push([handler, path]);
          }
        }
      }
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) {
      for (const m of methods) {
        if (!routes[m][path2]) {
          this.#insertPath(m, path2);
          routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || [];
        }
        routes[m][path2].push([handler, path2]);
      }
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) {
      matchers[method] = this.#buildMatcher(method);
    }
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) {
      for (const path in r) {
        const handlers = r[path];
        const pathData = trie.paths[path];
        if (!pathData) {
          staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
          continue;
        }
        handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [
          h,
          trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
            map[key] = paramReplacementMap[pathData[1][i][1]];
            return map;
          }, createNullObject())
        ]);
      }
    }
    return [regexp, indexReplacementMap.map((i) => handlerData[i]), staticMap];
  }
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/reg-exp-router/prepared-router.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/smart-router/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/smart-router/router.js
init_modules_watch_stub();
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
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

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/trie-router/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/trie-router/router.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/trie-router/node.js
init_modules_watch_stub();
var emptyParams = createNullObject();
var order = 0;
var Node2 = class _Node2 {
  static {
    __name(this, "_Node");
  }
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new _Node2();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) {
        possibleKeys.add(pattern[1]);
      }
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: [...possibleKeys],
        score: ++order
      }
    });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
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
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) {
            continue;
          }
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  node.#params,
                  params
                );
              }
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
                break;
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
    if (handlerSets[1]) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node = new Node2();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) {
      this.#node.insert(method, result, handler);
    }
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
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

// src/errors.ts
init_modules_watch_stub();

// src/logger.ts
init_modules_watch_stub();
var LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
function createLogger(minLevel) {
  const threshold = LEVEL_ORDER[minLevel] ?? LEVEL_ORDER.info;
  const emit = /* @__PURE__ */ __name((level, fields) => {
    if (LEVEL_ORDER[level] < threshold) return;
    console[level]({ level, ...fields });
  }, "emit");
  return {
    debug: /* @__PURE__ */ __name((fields) => emit("debug", fields), "debug"),
    info: /* @__PURE__ */ __name((fields) => emit("info", fields), "info"),
    warn: /* @__PURE__ */ __name((fields) => emit("warn", fields), "warn"),
    error: /* @__PURE__ */ __name((fields) => emit("error", fields), "error")
  };
}
__name(createLogger, "createLogger");

// src/errors.ts
var STATUS_TITLES = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout"
};
var STATUS_ENUM_KEYS = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  410: "GONE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  501: "NOT_IMPLEMENTED",
  502: "BAD_GATEWAY",
  503: "SERVICE_UNAVAILABLE",
  504: "GATEWAY_TIMEOUT"
};
var ApiHttpError = class extends Error {
  constructor(status, payload = {}) {
    super(typeof payload === "string" ? payload : "API error");
    this.status = status;
    this.name = "ApiHttpError";
    this.payload = typeof payload === "string" ? {
      message: payload,
      error: STATUS_TITLES[status] ?? STATUS_ENUM_KEYS[status] ?? "Error"
    } : payload;
  }
  status;
  static {
    __name(this, "ApiHttpError");
  }
  payload;
};
function normalizeMessage(message, fallback) {
  if (typeof message === "string" && message.length > 0) return message;
  if (Array.isArray(message) && message.length > 0) {
    return message.map((m) => String(m)).join("; ");
  }
  return fallback;
}
__name(normalizeMessage, "normalizeMessage");
function requestPath(c) {
  return new URL(c.req.url).pathname;
}
__name(requestPath, "requestPath");
function buildErrorResponse(err, path) {
  if (err instanceof ApiHttpError || err instanceof HTTPException) {
    const status = err.status;
    const raw2 = err instanceof ApiHttpError ? err.payload : (
      // Hono's own HTTPException (c.throw / internals): same treatment.
      { message: err.message }
    );
    const payload = typeof raw2 === "string" ? { message: raw2 } : { ...raw2 };
    const envelope = {
      statusCode: status,
      message: normalizeMessage(
        payload.message,
        STATUS_ENUM_KEYS[status] ?? "Error"
      ),
      error: typeof payload.error === "string" && payload.error.length > 0 ? payload.error : STATUS_ENUM_KEYS[status] ?? "Error",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      path
    };
    return { status, body: { ...payload, ...envelope } };
  }
  return {
    status: 500,
    body: {
      statusCode: 500,
      message: "Internal server error",
      error: "InternalServerError",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      path
    }
  };
}
__name(buildErrorResponse, "buildErrorResponse");
function routeNotFoundResponse(method, path) {
  return buildErrorResponse(
    new ApiHttpError(404, { message: `Cannot ${method} ${path}`, error: "Not Found" }),
    path
  );
}
__name(routeNotFoundResponse, "routeNotFoundResponse");
function respondToError(c, err) {
  const { status, body } = buildErrorResponse(err, requestPath(c));
  if (status === 500) {
    createLogger(c.env?.LOG_LEVEL).error({
      requestId: c.get("requestId"),
      message: "Unhandled exception outside HttpException",
      detail: err instanceof Error ? err.stack ?? String(err) : String(err)
    });
  }
  return c.json(body, status);
}
__name(respondToError, "respondToError");

// src/middleware/error-boundary.ts
init_modules_watch_stub();
function errorBoundary() {
  return async (c, next) => {
    let response;
    try {
      await next();
    } catch (err) {
      response = respondToError(c, err);
    }
    return response;
  };
}
__name(errorBoundary, "errorBoundary");

// src/middleware/request-id.ts
init_modules_watch_stub();
function sanitizeRequestId(raw2) {
  if (typeof raw2 !== "string") return null;
  const trimmed = raw2.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed
  ) ? trimmed : null;
}
__name(sanitizeRequestId, "sanitizeRequestId");
function requestLogging() {
  return async (c, next) => {
    const requestId = sanitizeRequestId(c.req.header("x-request-id")) ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const start = performance.now();
    try {
      await next();
    } finally {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      try {
        const path = requestPath(c);
        let route = path;
        try {
          route = c.req.routePath || path;
        } catch {
        }
        createLogger(c.env?.LOG_LEVEL).info({
          requestId,
          method: c.req.method,
          path,
          route,
          status: c.res.status,
          durationMs,
          message: "request completed"
        });
      } catch {
      }
    }
  };
}
__name(requestLogging, "requestLogging");

// src/middleware/guards.ts
init_modules_watch_stub();

// src/middleware/age-gate.ts
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/helper/cookie/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/utils/cookie.js
init_modules_watch_stub();
var relaxedCookieNameRegEx = /^[!#-:<>-[\]-~]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var trimCookieWhitespace = /* @__PURE__ */ __name((value) => {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const charCode = value.charCodeAt(start);
    if (charCode !== 32 && charCode !== 9) {
      break;
    }
    start++;
  }
  while (end > start) {
    const charCode = value.charCodeAt(end - 1);
    if (charCode !== 32 && charCode !== 9) {
      break;
    }
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}, "trimCookieWhitespace");
var parse = /* @__PURE__ */ __name((cookie, name) => {
  if (name && cookie.indexOf(name) === -1) {
    return {};
  }
  const pairs = cookie.split(";");
  const parsedCookie = /* @__PURE__ */ Object.create(null);
  for (const pairStr of pairs) {
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) {
      continue;
    }
    const cookieName = trimCookieWhitespace(pairStr.substring(0, valueStartPos));
    if (name && name !== cookieName || !relaxedCookieNameRegEx.test(cookieName) || cookieName in parsedCookie) {
      continue;
    }
    let cookieValue = trimCookieWhitespace(pairStr.substring(valueStartPos + 1));
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) {
      cookieValue = cookieValue.slice(1, -1);
    }
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = tryDecodeURIComponent(cookieValue);
      if (name) {
        break;
      }
    }
  }
  return parsedCookie;
}, "parse");

// ../../node_modules/.pnpm/hono@4.13.5/node_modules/hono/dist/helper/cookie/index.js
var getCookie = /* @__PURE__ */ __name((c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie) {
      return void 0;
    }
    let finalKey = key;
    if (prefix === "secure") {
      finalKey = "__Secure-" + key;
    } else if (prefix === "host") {
      finalKey = "__Host-" + key;
    }
    const obj2 = parse(cookie, finalKey);
    return obj2[finalKey];
  }
  if (!cookie) {
    return {};
  }
  const obj = parse(cookie);
  return obj;
}, "getCookie");

// src/middleware/age-gate.ts
var simpleConfirmationProvider = {
  async verifyAge(_userId) {
    return {
      verified: true,
      method: "simple-confirmation",
      timestamp: /* @__PURE__ */ new Date()
    };
  },
  async upgradeVerification(_userId, _method) {
    return {
      verified: true,
      method: "simple-confirmation",
      timestamp: /* @__PURE__ */ new Date()
    };
  }
};
function extractConfirmationToken(c) {
  const headerToken = c.req.header("x-age-confirmed");
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken;
  }
  const cookieToken = getCookie(c, "age_confirmed");
  if (typeof cookieToken === "string" && cookieToken.length > 0) {
    return cookieToken;
  }
  return void 0;
}
__name(extractConfirmationToken, "extractConfirmationToken");
function ageGate(provider = simpleConfirmationProvider) {
  return async (c, next) => {
    const token = extractConfirmationToken(c);
    if (!token) {
      throw new ApiHttpError(
        403,
        "Age confirmation required. Please confirm your age via the age-gate prompt."
      );
    }
    const result = await provider.verifyAge(token);
    if (!result.verified) {
      throw new ApiHttpError(
        403,
        "Age verification failed. Please try confirming your age again."
      );
    }
    await next();
  };
}
__name(ageGate, "ageGate");

// src/middleware/entitlement.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/entitlement/entitlement.service.ts
init_modules_watch_stub();

// src/nestjs-compat.ts
init_modules_watch_stub();
function Injectable() {
  return () => void 0;
}
__name(Injectable, "Injectable");
function Inject(_token) {
  return () => void 0;
}
__name(Inject, "Inject");
function Optional() {
  return () => void 0;
}
__name(Optional, "Optional");
var Logger = class {
  static {
    __name(this, "Logger");
  }
  constructor(_context) {
  }
  log() {
  }
  error() {
  }
  warn() {
  }
  debug() {
  }
  verbose() {
  }
};

// ../../packages/core-domain/src/entitlement/entitlement.types.ts
init_modules_watch_stub();
var FEATURE_TIER_MAP = {
  "product:browse": "FREE",
  "calculation:basic": "FREE",
  "calculation:detail": "PREMIUM",
  "calculation:history": "PREMIUM",
  "calculation:export": "PREMIUM",
  "declaration:summary": "PREMIUM",
  "api:batch": "PROFESSIONAL",
  "api:access": "PROFESSIONAL"
};
var TIER_ORDER = ["FREE", "PREMIUM", "PROFESSIONAL"];
function isTierSufficient(userTier, requiredTier) {
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}
__name(isTierSufficient, "isTierSufficient");

// ../../packages/core-domain/src/entitlement/entitlement.service.ts
var GLOBAL_TEST_TIER_OVERRIDE_ENV = "ENTITLEMENT_DEFAULT_TIER";
var EntitlementService = class {
  logger = new Logger(EntitlementService.name);
  /**
   * Check whether the caller has access to the given feature.
   *
   * @param account — the account context carrying the tier from
   *                  `accounts.tier`. A bare userId string is accepted from
   *                  callers that have not fetched the account record yet;
   *                  it resolves to the Phase 1 PREMIUM default until the
   *                  session wiring passes full contexts. `null` = anonymous.
   * @param feature — the feature being requested
   */
  checkAccess(account, feature) {
    const requiredTier = FEATURE_TIER_MAP[feature];
    if (account === null) {
      const allowed2 = requiredTier === "FREE";
      return {
        allowed: allowed2,
        tier: "FREE",
        reason: allowed2 ? void 0 : `Feature "${feature}" requires ${requiredTier} tier. Sign in or upgrade.`
      };
    }
    const userTier = this.resolveTier(account);
    const allowed = isTierSufficient(userTier, requiredTier);
    return {
      allowed,
      tier: userTier,
      reason: allowed ? void 0 : `Feature "${feature}" requires ${requiredTier} tier. Current tier: ${userTier}.`
    };
  }
  /**
   * Resolve the tier for a known account.
   *
   * Precedence: global test override (non-production only, uniform), then
   * the account record's tier. Legacy bare-userId callers keep the Phase 1
   * PREMIUM default until every caller passes an {@link AccountContext}.
   */
  resolveTier(account) {
    const override = this.globalTestOverride();
    if (override !== null) return override;
    if (typeof account === "string") {
      return "PREMIUM";
    }
    return account.tier;
  }
  /**
   * Global test override from `ENTITLEMENT_DEFAULT_TIER`.
   *
   * Refused in production so a stray env var can never rewrite real tiers;
   * applied uniformly (never keyed on user identifiers) per the
   * subscription-billing spec.
   */
  globalTestOverride() {
    if (false) return null;
    const raw2 = process.env[GLOBAL_TEST_TIER_OVERRIDE_ENV];
    if (raw2 === void 0) return null;
    return this.parseTier(raw2);
  }
  /**
   * Parse a tier string, returning null on invalid input.
   */
  parseTier(raw2) {
    const upper = raw2.toUpperCase().trim();
    if (upper === "PREMIUM") return "PREMIUM";
    if (upper === "PROFESSIONAL") return "PROFESSIONAL";
    if (upper === "FREE") return "FREE";
    this.logger.warn(
      `Invalid entitlement tier in env ${GLOBAL_TEST_TIER_OVERRIDE_ENV}: "${raw2}"`
    );
    return null;
  }
};
__name(EntitlementService, "EntitlementService");
EntitlementService = __decorateClass([
  Injectable()
], EntitlementService);

// src/auth/authenticated-account.ts
init_modules_watch_stub();
var SESSION_TOKEN_CONTEXT_KEY = "sessionToken";
var USER_CONTEXT_KEY = "user";

// src/middleware/entitlement.ts
function createEntitlementService() {
  return new EntitlementService();
}
__name(createEntitlementService, "createEntitlementService");
function toAccountContext(user) {
  if (user === null || user === void 0) return null;
  if (typeof user === "string") return user;
  const candidate = user;
  const hasTier = typeof candidate.tier === "string" && candidate.tier.length > 0;
  if (!hasTier) {
    return typeof candidate.id === "string" ? candidate.id : null;
  }
  const userId = typeof candidate.userId === "string" ? candidate.userId : candidate.id;
  return typeof userId === "string" ? { userId, tier: candidate.tier } : null;
}
__name(toAccountContext, "toAccountContext");
function requireFeature(feature) {
  return (c, next) => {
    const entitlement = createEntitlementService();
    const account = toAccountContext(c.get(USER_CONTEXT_KEY));
    const result = entitlement.checkAccess(account, feature);
    if (result.allowed) {
      return next();
    }
    throw new ApiHttpError(403, {
      statusCode: 403,
      message: result.reason ?? "Access denied",
      error: "InsufficientEntitlement",
      requiredTier: feature,
      currentTier: result.tier
    });
  };
}
__name(requireFeature, "requireFeature");

// src/middleware/feature-flags.ts
init_modules_watch_stub();
var FeatureFlag = {
  /** Gate new merchant data sources (scrapers, APIs, partner feeds). */
  NEW_MERCHANT_SOURCE: "NEW_MERCHANT_SOURCE",
  /** Gate new tax rule versions before legal confirmation. */
  NEW_TAX_RULESET: "NEW_TAX_RULESET",
  /** Gate new UI ranking/sorting behavior. */
  UI_RANKING_V2: "UI_RANKING_V2",
  /**
   * Gate historical price intelligence (price-history API + UI charts).
   * Spec/design slug: `enable_historical_price_intelligence`.
   * Default OFF until product review — instant rollback for the
   * user-facing historical data presentation.
   */
  HISTORICAL_PRICE_INTELLIGENCE: "HISTORICAL_PRICE_INTELLIGENCE",
  /**
   * Gate basket optimization API and UI (multi-store split, tiered shipping).
   * Spec slug: `enable_basket_optimization`.
   * Default OFF during active development — enabled once integration tests pass.
   */
  BASKET_OPTIMIZATION: "BASKET_OPTIMIZATION",
  /**
   * Gate advanced Phase 2 surfaces: scenario (endpoints + UI), report
   * (endpoint + export buttons), reliability (endpoint + embedded scores),
   * and declaration guidance (field + panel).
   * Spec/design slug: `enable_advanced_features`.
   * Default OFF for instant rollback of all four surfaces together.
   */
  ADVANCED_FEATURES: "ADVANCED_FEATURES",
  /**
   * Gate the operator console — the authenticated UI + API at
   * `/ops/console/**`. Default OFF per the compliance rule (new UI ships
   * flag-off); the bearer+allowlist guard stays on regardless of the flag.
   */
  OPERATOR_CONSOLE: "OPERATOR_CONSOLE"
};
var ALL_FLAGS = Object.values(FeatureFlag);
var FeatureFlagService = class {
  static {
    __name(this, "FeatureFlagService");
  }
  flags;
  rolloutPct = {};
  constructor(env) {
    this.flags = this.loadFromEnv(env);
  }
  /** Check if a feature flag is globally enabled. Synchronous — no I/O. */
  isEnabled(flag) {
    return this.flags[flag] ?? false;
  }
  /**
   * Check if a feature flag is enabled for a specific entity (gradual rollout).
   *
   * When the flag is fully enabled (100 %) or disabled (0 %) the global value
   * is returned directly. For partial rollout the entity ID is hashed to
   * produce a deterministic bucket.
   */
  isEnabledForEntity(flag, entityId) {
    if (!this.flags[flag]) return false;
    const pct = this.rolloutPct[flag] ?? 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    return this.bucket(entityId) < pct;
  }
  /**
   * The resolved boolean map — the bootstrap parity contract. Booleans
   * only; rollout percentages are not exposed.
   */
  resolveFlagMap() {
    return { ...this.flags };
  }
  /** Load flag values from the environment, falling back to all-disabled. */
  loadFromEnv(env) {
    const cfg = {};
    for (const flag of ALL_FLAGS) {
      const raw2 = env[`FF_${flag}`];
      if (raw2 === void 0 || raw2 === "") {
        cfg[flag] = false;
      } else if (raw2 === "true" || raw2 === "1") {
        cfg[flag] = true;
      } else if (/^\d+$/.test(raw2)) {
        const pct = Math.min(100, Math.max(0, parseInt(raw2, 10)));
        this.rolloutPct[flag] = pct;
        cfg[flag] = pct > 0;
      } else {
        cfg[flag] = false;
      }
      const rolloutRaw = env[`FF_ROLLOUT_${flag}`];
      if (rolloutRaw !== void 0 && rolloutRaw !== "") {
        this.rolloutPct[flag] = Math.min(100, Math.max(0, parseInt(rolloutRaw, 10)));
      }
    }
    return cfg;
  }
  /** Deterministic bucket [0–100) from an entity ID. */
  bucket(entityId) {
    let hash = 0;
    for (let i = 0; i < entityId.length; i++) {
      hash = hash * 31 + entityId.charCodeAt(i) | 0;
    }
    return (hash & 2147483647) % 100;
  }
};
function requireFeatureFlag(flag) {
  return (c, next) => {
    const featureFlags = new FeatureFlagService(c.env);
    if (featureFlags.isEnabled(flag)) {
      return next();
    }
    throw new ApiHttpError(403, `Feature "${flag}" is not enabled`);
  };
}
__name(requireFeatureFlag, "requireFeatureFlag");

// src/middleware/launch-gate.ts
init_modules_watch_stub();
var GATE_ENV_KEYS = {
  legalOpinion: "LAUNCH_GATE_LEGAL_OPINION",
  taxSourceMapping: "LAUNCH_GATE_TAX_SOURCE_MAPPING",
  correctionMechanism: "LAUNCH_GATE_CORRECTION_MECHANISM",
  override: "LAUNCH_GATES_OVERRIDE"
};
var LaunchGateService = class _LaunchGateService {
  static {
    __name(this, "LaunchGateService");
  }
  gates;
  constructor(env) {
    this.gates = _LaunchGateService.loadFromEnv(
      env
    );
  }
  /**
   * Whether landed-cost calculations are enabled.
   * True only when ALL three gates (legal, tax, correction) are confirmed.
   */
  isCalculationEnabled() {
    return this.gates.launchReady;
  }
  /**
   * Whether price data is visible to end users.
   * True only when ALL three gates (legal, tax, correction) are confirmed.
   */
  isPriceDataVisible() {
    return this.gates.launchReady;
  }
  /** Return the full gate status snapshot (defensive copy). */
  getGateStatus() {
    return { ...this.gates };
  }
  /** Load gate values from the environment, falling back to defaults. */
  static loadFromEnv(env) {
    const override = env[GATE_ENV_KEYS.override] === "true";
    if (override) {
      return {
        legalOpinionConfirmed: true,
        taxSourceMappingConfirmed: true,
        correctionMechanismConfirmed: true,
        launchReady: true
      };
    }
    const legalOpinionConfirmed = env[GATE_ENV_KEYS.legalOpinion] === "true";
    const taxSourceMappingConfirmed = env[GATE_ENV_KEYS.taxSourceMapping] === "true";
    const correctionMechanismConfirmed = env[GATE_ENV_KEYS.correctionMechanism] === "true";
    const launchReady = legalOpinionConfirmed && taxSourceMappingConfirmed && correctionMechanismConfirmed;
    return {
      legalOpinionConfirmed,
      taxSourceMappingConfirmed,
      correctionMechanismConfirmed,
      launchReady
    };
  }
};
function requireLaunchGate(gateType) {
  return (c, next) => {
    const launchGate = new LaunchGateService(c.env);
    switch (gateType) {
      case "CALCULATION":
        if (launchGate.isCalculationEnabled()) {
          return next();
        }
        throw new ApiHttpError(
          403,
          "Landed-cost calculations are not yet publicly available. All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed."
        );
      case "PRICE_DATA":
        if (launchGate.isPriceDataVisible()) {
          return next();
        }
        throw new ApiHttpError(
          403,
          "Price data is not yet publicly available. All launch gates (legal opinion, tax-source mapping, correction mechanism) must be confirmed."
        );
    }
  };
}
__name(requireLaunchGate, "requireLaunchGate");

// src/middleware/ops-access.ts
init_modules_watch_stub();
function parseAllowlist(raw2) {
  const trimmed = raw2?.trim();
  if (!trimmed) return [];
  const entries = [];
  for (const part of trimmed.split(",")) {
    const item = part.trim();
    if (!item) continue;
    if (item.includes("/")) {
      const cidr = parseIpv4Cidr(item);
      if (cidr) entries.push({ kind: "cidr", ...cidr });
    } else {
      entries.push({ kind: "ip", value: item.toLowerCase() });
    }
  }
  return entries;
}
__name(parseAllowlist, "parseAllowlist");
function parseIpv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}
__name(parseIpv4, "parseIpv4");
function parseIpv4Cidr(item) {
  const [address, bits] = item.split("/");
  const addressValue = parseIpv4(address);
  const prefixBits = Number(bits);
  if (addressValue === null || !Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 32) {
    return null;
  }
  return { address: addressValue, prefixBits };
}
__name(parseIpv4Cidr, "parseIpv4Cidr");
function matchesEntry(entry, rawIp) {
  const ip = rawIp.startsWith("::ffff:") ? rawIp.slice("::ffff:".length) : rawIp;
  if (entry.kind === "ip") return entry.value === ip.toLowerCase();
  const candidate = parseIpv4(ip);
  if (candidate === null) return false;
  const mask = entry.prefixBits === 0 ? 0 : 4294967295 << 32 - entry.prefixBits >>> 0;
  return (candidate & mask) === (entry.address & mask);
}
__name(matchesEntry, "matchesEntry");
function opsAccessConfig(env) {
  const vars = env;
  return {
    bearerToken: vars.OPS_BEARER_TOKEN?.trim() || null,
    allowlist: parseAllowlist(vars.OPS_IP_ALLOWLIST)
  };
}
__name(opsAccessConfig, "opsAccessConfig");
function digestsMatch(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
__name(digestsMatch, "digestsMatch");
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function tokenMatches(expected, presented) {
  const [expectedDigest, presentedDigest] = await Promise.all([
    sha256Hex(expected),
    sha256Hex(presented)
  ]);
  return digestsMatch(expectedDigest, presentedDigest);
}
__name(tokenMatches, "tokenMatches");
function opsAccess() {
  return async (c, next) => {
    const { bearerToken, allowlist } = opsAccessConfig(c.env);
    if (bearerToken === null && allowlist.length === 0) {
      createLogger(c.env.LOG_LEVEL).warn({
        requestId: c.get("requestId"),
        message: "Ops route denied: no OPS_BEARER_TOKEN or OPS_IP_ALLOWLIST configured"
      });
      throw new ApiHttpError(403, "Forbidden");
    }
    if (allowlist.length > 0) {
      const ip = c.req.header("CF-Connecting-IP") ?? "";
      if (!allowlist.some((entry) => matchesEntry(entry, ip))) {
        throw new ApiHttpError(403, "Forbidden");
      }
    }
    if (bearerToken !== null) {
      const header = c.req.header("authorization");
      const presented = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (presented.length === 0 || !await tokenMatches(bearerToken, presented)) {
        throw new ApiHttpError(403, "Forbidden");
      }
    }
    await next();
  };
}
__name(opsAccess, "opsAccess");

// src/middleware/session-auth.ts
init_modules_watch_stub();

// src/auth/session-resolver.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/session.repository.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/abstracts.ts
init_modules_watch_stub();
var ProductRepository = class {
  /**
   * Ranked search over name, brand, and manufacturer (task 5.1, change
   * technical-assessment-remediation) — pg_trgm similarity ranking with
   * a product-id tiebreaker, backed by the gin_trgm_ops indexes of
   * migration 0016_product_search_pg_trgm.
   *
   * Concrete (not abstract) with a loud default so the many in-memory
   * test doubles extending this class keep compiling; only the Drizzle
   * implementation supports it, matching every real wiring.
   */
  searchRanked(_query, _limit) {
    return Promise.reject(
      new Error("searchRanked is not implemented by this repository")
    );
  }
};
__name(ProductRepository, "ProductRepository");
ProductRepository = __decorateClass([
  Injectable()
], ProductRepository);
var TaxRateRepository = class {
};
__name(TaxRateRepository, "TaxRateRepository");
TaxRateRepository = __decorateClass([
  Injectable()
], TaxRateRepository);
var TransportOfferRepository = class {
};
__name(TransportOfferRepository, "TransportOfferRepository");
TransportOfferRepository = __decorateClass([
  Injectable()
], TransportOfferRepository);
var CalculationRecordRepository = class {
};
__name(CalculationRecordRepository, "CalculationRecordRepository");
CalculationRecordRepository = __decorateClass([
  Injectable()
], CalculationRecordRepository);
var AuditRepository = class {
};
__name(AuditRepository, "AuditRepository");
AuditRepository = __decorateClass([
  Injectable()
], AuditRepository);
var AccountRepository = class {
};
__name(AccountRepository, "AccountRepository");
AccountRepository = __decorateClass([
  Injectable()
], AccountRepository);
var SavedBasketRepository = class {
};
__name(SavedBasketRepository, "SavedBasketRepository");
SavedBasketRepository = __decorateClass([
  Injectable()
], SavedBasketRepository);
var SessionRepository = class {
};
__name(SessionRepository, "SessionRepository");
SessionRepository = __decorateClass([
  Injectable()
], SessionRepository);
var SavedScenarioRepository = class {
};
__name(SavedScenarioRepository, "SavedScenarioRepository");
SavedScenarioRepository = __decorateClass([
  Injectable()
], SavedScenarioRepository);
var FxRateRepository = class {
};
__name(FxRateRepository, "FxRateRepository");
FxRateRepository = __decorateClass([
  Injectable()
], FxRateRepository);
var PriceObservationRepository = class {
};
__name(PriceObservationRepository, "PriceObservationRepository");
PriceObservationRepository = __decorateClass([
  Injectable()
], PriceObservationRepository);
var PriceHistorySummaryRepository = class {
};
__name(PriceHistorySummaryRepository, "PriceHistorySummaryRepository");
PriceHistorySummaryRepository = __decorateClass([
  Injectable()
], PriceHistorySummaryRepository);
var AggregationWatermarkRepository = class {
};
__name(AggregationWatermarkRepository, "AggregationWatermarkRepository");
AggregationWatermarkRepository = __decorateClass([
  Injectable()
], AggregationWatermarkRepository);
var MerchantTermsRepository = class {
};
__name(MerchantTermsRepository, "MerchantTermsRepository");
MerchantTermsRepository = __decorateClass([
  Injectable()
], MerchantTermsRepository);
var MerchantRegistryRepository = class {
};
__name(MerchantRegistryRepository, "MerchantRegistryRepository");
MerchantRegistryRepository = __decorateClass([
  Injectable()
], MerchantRegistryRepository);
var ClickCounterSnapshotRepository = class {
};
__name(ClickCounterSnapshotRepository, "ClickCounterSnapshotRepository");
ClickCounterSnapshotRepository = __decorateClass([
  Injectable()
], ClickCounterSnapshotRepository);
var BasketCalculationRecordRepository = class {
};
__name(BasketCalculationRecordRepository, "BasketCalculationRecordRepository");
BasketCalculationRecordRepository = __decorateClass([
  Injectable()
], BasketCalculationRecordRepository);

// ../../packages/data-platform/src/repositories/d1/session.repository.ts
function toContractSession(row) {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    accountId: row.account_id,
    rotatedFromId: row.rotated_from_id,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at)
  };
}
__name(toContractSession, "toContractSession");
var SESSION_COLUMNS = `
  id, token_hash, account_id, rotated_from_id, created_at, expires_at,
  revoked_at`;
var INSERT_SQL = `
  INSERT INTO sessions (token_hash, account_id, rotated_from_id, created_at, expires_at, revoked_at)
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING ${SESSION_COLUMNS}`;
var ACTIVE_PREDICATE = `revoked_at IS NULL AND expires_at > ?`;
var FIND_ACTIVE_BY_HASH_SQL = `
  SELECT ${SESSION_COLUMNS} FROM sessions
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}
   LIMIT 1`;
var INSERT_SUCCESSOR_SQL = `
  INSERT INTO sessions (token_hash, account_id, rotated_from_id, created_at, expires_at)
  SELECT ?, account_id, id, ?, ? FROM sessions
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;
var REVOKE_PRESENTED_SQL = `
  UPDATE sessions SET revoked_at = ?
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;
var REVOKE_BY_HASH_SQL = `
  UPDATE sessions SET revoked_at = ?
   WHERE token_hash = ? AND ${ACTIVE_PREDICATE}`;
var DELETE_EXPIRED_SQL = `
  DELETE FROM sessions WHERE expires_at < ?`;
var D1SessionRepository = class extends SessionRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async create(record) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await this.d1.prepare(INSERT_SQL).bind(
      record.tokenHash,
      record.accountId,
      record.rotatedFromId ?? null,
      record.createdAt?.toISOString() ?? now,
      record.expiresAt.toISOString(),
      record.revokedAt?.toISOString() ?? null
    ).first();
    if (!row) {
      throw new Error("sessions INSERT .. RETURNING returned no row");
    }
    return toContractSession(row);
  }
  /** @inheritdoc */
  async findActiveByTokenHash(tokenHash) {
    const row = await this.d1.prepare(FIND_ACTIVE_BY_HASH_SQL).bind(tokenHash, (/* @__PURE__ */ new Date()).toISOString()).first();
    return row ? toContractSession(row) : null;
  }
  /** @inheritdoc */
  async rotate(tokenHash, newTokenHash, expiresAt) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.d1.batch([
      this.d1.prepare(INSERT_SUCCESSOR_SQL).bind(newTokenHash, now, expiresAt.toISOString(), tokenHash, now),
      this.d1.prepare(REVOKE_PRESENTED_SQL).bind(now, tokenHash, now)
    ]);
    const row = await this.d1.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE token_hash = ?`).bind(newTokenHash).first();
    return row ? toContractSession(row) : null;
  }
  /** @inheritdoc */
  async revokeByTokenHash(tokenHash) {
    const result = await this.d1.prepare(REVOKE_BY_HASH_SQL).bind((/* @__PURE__ */ new Date()).toISOString(), tokenHash, (/* @__PURE__ */ new Date()).toISOString()).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
  /** @inheritdoc */
  async deleteExpiredBefore(cutoff) {
    const result = await this.d1.prepare(DELETE_EXPIRED_SQL).bind(cutoff.toISOString()).run();
    return Number(result.meta.changes ?? 0);
  }
};
__name(D1SessionRepository, "D1SessionRepository");
D1SessionRepository = __decorateClass([
  Injectable()
], D1SessionRepository);

// ../../packages/application-api/src/accounts/email-verification.ts
init_modules_watch_stub();
var PLACEHOLDER_EMAIL_SUFFIX = "@placeholder.local";
var MAX_EMAIL_LENGTH = 320;
function isPlaceholderEmail(email) {
  return email.endsWith(PLACEHOLDER_EMAIL_SUFFIX);
}
__name(isPlaceholderEmail, "isPlaceholderEmail");
function isAccountVerified(email) {
  return email.length > 0 && !isPlaceholderEmail(email);
}
__name(isAccountVerified, "isAccountVerified");
function isValidEmailFormat(email) {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const [local, domain] = [email.slice(0, at), email.slice(at + 1)];
  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  return true;
}
__name(isValidEmailFormat, "isValidEmailFormat");

// src/auth/session-resolver.ts
var KNOWN_TIERS = /* @__PURE__ */ new Set(["FREE", "PREMIUM", "PROFESSIONAL"]);
async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(hashToken, "hashToken");
var ACCOUNT_BY_ID_SQL = `
  SELECT id, user_id, email, tier FROM accounts WHERE id = ? LIMIT 1`;
async function resolveAccountByToken(d1, token) {
  const sessions = new D1SessionRepository(d1);
  const session = await sessions.findActiveByTokenHash(await hashToken(token));
  if (session === null) {
    return null;
  }
  const row = await d1.prepare(ACCOUNT_BY_ID_SQL).bind(session.accountId).first();
  if (row === null) {
    return null;
  }
  return {
    accountId: row.id,
    userId: row.user_id,
    tier: KNOWN_TIERS.has(row.tier) ? row.tier : "FREE",
    verified: isAccountVerified(row.email)
  };
}
__name(resolveAccountByToken, "resolveAccountByToken");

// src/middleware/session-auth.ts
var SESSION_COOKIE_NAME = "rajahinta_session";
function hasLegacyUserIdHeader(c) {
  const value = c.req.header("x-user-id");
  return value !== void 0 && value.trim().length > 0;
}
__name(hasLegacyUserIdHeader, "hasLegacyUserIdHeader");
function sessionAuth() {
  return async (c, next) => {
    if (hasLegacyUserIdHeader(c)) {
      throw new ApiHttpError(401, {
        statusCode: 401,
        message: `The x-user-id header is no longer accepted. Authenticate with the ${SESSION_COOKIE_NAME} cookie issued by POST /api/v1/account/session.`,
        error: "LegacyUserIdHeaderRejected"
      });
    }
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token === void 0 || token.length === 0) {
      throw new ApiHttpError(401, {
        statusCode: 401,
        message: "Authentication required: no session cookie presented.",
        error: "SessionRequired"
      });
    }
    const account = await resolveAccountByToken(c.env.DB, token);
    if (account === null) {
      throw new ApiHttpError(401, {
        statusCode: 401,
        message: "Session token is invalid, expired, or revoked.",
        error: "InvalidSession"
      });
    }
    c.set(USER_CONTEXT_KEY, account);
    c.set(SESSION_TOKEN_CONTEXT_KEY, token);
    await next();
  };
}
__name(sessionAuth, "sessionAuth");

// src/middleware/guards.ts
var GUARDED_ROUTES = [
  // DeclarationController — GET :recordId adds the entitlement on top of
  // the class-level age gate (registered as a prefix below).
  {
    methods: ["GET"],
    path: "/api/v1/declaration/:recordId",
    use: [requireFeature("declaration:summary")]
  },
  // AccountController — class-level SessionAuthGuard, enumerated per
  // method so the SessionController's POST /session (same prefix) stays
  // public. Scenarios add the method-level FeatureFlagGuard.
  { methods: ["GET"], path: "/api/v1/account/export", use: [sessionAuth()] },
  {
    methods: ["GET", "POST"],
    path: "/api/v1/account/baskets",
    use: [sessionAuth()]
  },
  {
    methods: ["DELETE"],
    path: "/api/v1/account/baskets/:basketId",
    use: [sessionAuth()]
  },
  {
    methods: ["GET", "POST"],
    path: "/api/v1/account/history",
    use: [sessionAuth()]
  },
  {
    methods: ["GET"],
    path: "/api/v1/account/subscription",
    use: [sessionAuth()]
  },
  {
    methods: ["POST"],
    path: "/api/v1/account/verify-email",
    use: [sessionAuth()]
  },
  {
    methods: ["GET", "POST"],
    path: "/api/v1/account/scenarios",
    use: [sessionAuth(), requireFeatureFlag("ADVANCED_FEATURES")]
  },
  {
    methods: ["DELETE"],
    path: "/api/v1/account/scenarios/:id",
    use: [sessionAuth(), requireFeatureFlag("ADVANCED_FEATURES")]
  },
  // SessionController — method-level SessionAuthGuard; POST /session
  // (issuance) is rate-limited only in Nest and must stay public here.
  {
    methods: ["POST"],
    path: "/api/v1/account/session/rotate",
    use: [sessionAuth()]
  },
  {
    methods: ["DELETE"],
    path: "/api/v1/account/session",
    use: [sessionAuth()]
  },
  // OpsDashboardController — OpsAccessGuard only (no console flag).
  { methods: ["GET"], path: "/ops/health", use: [opsAccess()] }
];
function registerGuardMiddleware(app2) {
  app2.use("/api/v1/calculator/*", requireLaunchGate("CALCULATION"), ageGate());
  app2.on("GET", "/api/v1/products", requireLaunchGate("PRICE_DATA"), ageGate());
  app2.on("GET", "/api/v1/products/:id", requireLaunchGate("PRICE_DATA"), ageGate());
  app2.use("/api/v1/basket/*", requireFeatureFlag("BASKET_OPTIMIZATION"));
  app2.use("/api/v1/declaration/*", ageGate());
  app2.use("/ops/console/*", opsAccess(), requireFeatureFlag("OPERATOR_CONSOLE"));
  for (const route of GUARDED_ROUTES) {
    for (const method of route.methods) {
      if (route.use.length === 1) {
        app2.on(method, route.path, route.use[0]);
      } else {
        app2.on(method, route.path, route.use[0], route.use[1]);
      }
    }
  }
  return app2;
}
__name(registerGuardMiddleware, "registerGuardMiddleware");

// src/middleware/rate-limit.ts
init_modules_watch_stub();

// src/do/client.ts
init_modules_watch_stub();
var DO_URL = "https://do.internal/";
function rateLimiterStub(env, clientKey) {
  const namespace = env.RATE_LIMITER;
  if (!namespace) {
    throw new Error("RATE_LIMITER Durable Object binding is not configured");
  }
  return namespace.get(namespace.idFromName(clientKey));
}
__name(rateLimiterStub, "rateLimiterStub");
async function checkRateLimit(env, clientKey, params) {
  return callRateLimiter(env, clientKey, {
    op: "check",
    ...params
  });
}
__name(checkRateLimit, "checkRateLimit");
async function callRateLimiter(env, clientKey, request) {
  const response = await rateLimiterStub(env, clientKey).fetch(
    new Request(DO_URL, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  if (!response.ok) {
    throw new Error(`RateLimiterDO request failed: ${response.status}`);
  }
  return await response.json();
}
__name(callRateLimiter, "callRateLimiter");
function idempotencyStub(env) {
  const namespace = env.IDEMPOTENCY;
  if (!namespace) {
    throw new Error("IDEMPOTENCY Durable Object binding is not configured");
  }
  return namespace.get(namespace.idFromName("idempotency"));
}
__name(idempotencyStub, "idempotencyStub");
async function idempotencyInvalidateVersions(env, versions) {
  const { deleted } = await callIdempotency(env, {
    op: "invalidateVersions",
    versions
  });
  return deleted;
}
__name(idempotencyInvalidateVersions, "idempotencyInvalidateVersions");
async function idempotencyGetByKey(env, key) {
  const { found, entry } = await callIdempotency(
    env,
    { op: "getByKey", key }
  );
  return found && entry !== void 0 ? entry : null;
}
__name(idempotencyGetByKey, "idempotencyGetByKey");
async function idempotencyPutByKey(env, key, result, options) {
  await callIdempotency(env, {
    op: "putByKey",
    key,
    result,
    ...options
  });
}
__name(idempotencyPutByKey, "idempotencyPutByKey");
async function claimJob(env, key, options) {
  const { outcome } = await callIdempotency(env, {
    op: "claimJob",
    key,
    ...options
  });
  return outcome;
}
__name(claimJob, "claimJob");
async function completeJob(env, key, options) {
  await callIdempotency(env, { op: "completeJob", key, ...options });
}
__name(completeJob, "completeJob");
async function releaseJob(env, key) {
  await callIdempotency(env, { op: "releaseJob", key });
}
__name(releaseJob, "releaseJob");
async function callIdempotency(env, request) {
  const response = await idempotencyStub(env).fetch(
    new Request(DO_URL, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  if (!response.ok) {
    throw new Error(`IdempotencyDO request failed: ${response.status}`);
  }
  return await response.json();
}
__name(callIdempotency, "callIdempotency");
function clickCounterStub(env) {
  const namespace = env.CLICK_COUNTER;
  if (!namespace) {
    throw new Error("CLICK_COUNTER Durable Object binding is not configured");
  }
  return namespace.get(namespace.idFromName("click-counter"));
}
__name(clickCounterStub, "clickCounterStub");
async function recordClick(env, merchantId, url, options) {
  await callClickCounter(env, { op: "increment", merchantId, url, ...options });
}
__name(recordClick, "recordClick");
async function getClickCounts(env) {
  const { counts } = await callClickCounter(env, { op: "counts" });
  return counts;
}
__name(getClickCounts, "getClickCounts");
async function drainClickCounter(env, nowMs) {
  const { snapshot } = await callClickCounter(
    env,
    { op: "drain", nowMs }
  );
  return snapshot;
}
__name(drainClickCounter, "drainClickCounter");
async function callClickCounter(env, request) {
  const response = await clickCounterStub(env).fetch(
    new Request(DO_URL, {
      method: "POST",
      body: JSON.stringify(request)
    })
  );
  if (!response.ok) {
    throw new Error(`ClickCounterDO request failed: ${response.status}`);
  }
  return await response.json();
}
__name(callClickCounter, "callClickCounter");

// src/do/identity.ts
init_modules_watch_stub();
var CLIENT_IDENTITY_HEADER = "CF-Connecting-IP";
function resolveClientIdentity(headers) {
  const value = headers.get(CLIENT_IDENTITY_HEADER);
  const ip = value?.split(",")[0]?.trim();
  return ip ? ip : "unknown";
}
__name(resolveClientIdentity, "resolveClientIdentity");

// src/middleware/rate-limit.ts
var RATE_LIMIT_PROFILES = {
  DEFAULT: { limit: 60, windowMs: 6e4 },
  CALCULATOR: { limit: 10, windowMs: 6e4 },
  BASKET: { limit: 10, windowMs: 6e4 },
  SEARCH: { limit: 30, windowMs: 6e4 },
  DECLARATION: { limit: 20, windowMs: 6e4 },
  HISTORICAL: { limit: 30, windowMs: 6e4 }
};
function requireRateLimit(profile) {
  return async (c, next) => {
    if (!c.env.RATE_LIMITER) {
      await next();
      return;
    }
    const { limit, windowMs } = RATE_LIMIT_PROFILES[profile];
    const params = { profile, limit, windowMs };
    const clientKey = resolveClientIdentity(c.req.raw.headers);
    const decision = await checkRateLimit(c.env, clientKey, params);
    if (decision.allowed) {
      await next();
      return;
    }
    const retryAfter2 = decision.retryAfterSeconds ?? Math.max(0, Math.ceil((decision.resetAtMs - Date.now()) / 1e3));
    c.header("Retry-After", String(retryAfter2));
    throw new ApiHttpError(429, {
      statusCode: 429,
      message: `Rate limit exceeded. Try again in ${retryAfter2}s.`,
      error: "TooManyRequests",
      retryAfterSeconds: retryAfter2
    });
  };
}
__name(requireRateLimit, "requireRateLimit");

// src/routes/calculator.routes.ts
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/index.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
init_modules_watch_stub();
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  __name(assertIs, "assertIs");
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  __name(assertNever, "assertNever");
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  __name(joinValues, "joinValues");
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = /* @__PURE__ */ __name((data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
}, "getParsedType");

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = /* @__PURE__ */ __name((obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
}, "quotelessJson");
var ZodError = class _ZodError extends Error {
  static {
    __name(this, "ZodError");
  }
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = /* @__PURE__ */ __name((error) => {
      for (const issue2 of error.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }, "processError");
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue2) => issue2.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = /* @__PURE__ */ __name((issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "bigint")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
  }
  return { message };
}, "errorMap");
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
__name(setErrorMap, "setErrorMap");
function getErrorMap() {
  return overrideErrorMap;
}
__name(getErrorMap, "getErrorMap");

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
init_modules_watch_stub();
var makeIssue = /* @__PURE__ */ __name((params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
}, "makeIssue");
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue2);
}
__name(addIssueToContext, "addIssueToContext");
var ParseStatus = class _ParseStatus {
  static {
    __name(this, "ParseStatus");
  }
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = /* @__PURE__ */ __name((value) => ({ status: "dirty", value }), "DIRTY");
var OK = /* @__PURE__ */ __name((value) => ({ status: "valid", value }), "OK");
var isAborted = /* @__PURE__ */ __name((x) => x.status === "aborted", "isAborted");
var isDirty = /* @__PURE__ */ __name((x) => x.status === "dirty", "isDirty");
var isValid = /* @__PURE__ */ __name((x) => x.status === "valid", "isValid");
var isAsync = /* @__PURE__ */ __name((x) => typeof Promise !== "undefined" && x instanceof Promise, "isAsync");

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
init_modules_watch_stub();

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
init_modules_watch_stub();
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  static {
    __name(this, "ParseInputLazyPath");
  }
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = /* @__PURE__ */ __name((ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
}, "handleResult");
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = /* @__PURE__ */ __name((iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  }, "customMap");
  return { errorMap: customMap, description };
}
__name(processCreateParams, "processCreateParams");
var ZodType = class {
  static {
    __name(this, "ZodType");
  }
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = /* @__PURE__ */ __name((val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    }, "getIssueProperties");
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = /* @__PURE__ */ __name(() => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      }), "setError");
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: /* @__PURE__ */ __name((data) => this["~validate"](data), "validate")
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
__name(timeRegexSource, "timeRegexSource");
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
__name(timeRegex, "timeRegex");
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
__name(datetimeRegex, "datetimeRegex");
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
__name(isValidIP, "isValidIP");
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
__name(isValidJWT, "isValidJWT");
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
__name(isValidCidr, "isValidCidr");
var ZodString = class _ZodString extends ZodType {
  static {
    __name(this, "ZodString");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
__name(floatSafeRemainder, "floatSafeRemainder");
var ZodNumber = class _ZodNumber extends ZodType {
  static {
    __name(this, "ZodNumber");
  }
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  static {
    __name(this, "ZodBigInt");
  }
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  static {
    __name(this, "ZodBoolean");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  static {
    __name(this, "ZodDate");
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  static {
    __name(this, "ZodSymbol");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  static {
    __name(this, "ZodUndefined");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  static {
    __name(this, "ZodNull");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  static {
    __name(this, "ZodAny");
  }
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  static {
    __name(this, "ZodUnknown");
  }
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  static {
    __name(this, "ZodNever");
  }
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  static {
    __name(this, "ZodVoid");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  static {
    __name(this, "ZodArray");
  }
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
__name(deepPartialify, "deepPartialify");
var ZodObject = class _ZodObject extends ZodType {
  static {
    __name(this, "ZodObject");
  }
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: /* @__PURE__ */ __name((issue2, ctx) => {
          const defaultError = this._def.errorMap?.(issue2, ctx).message ?? ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }, "errorMap")
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => ({
        ...this._def.shape(),
        ...augmentation
      }), "shape")
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: /* @__PURE__ */ __name(() => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }), "shape"),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => shape, "shape")
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => shape, "shape")
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: /* @__PURE__ */ __name(() => newShape, "shape")
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: /* @__PURE__ */ __name(() => shape, "shape"),
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: /* @__PURE__ */ __name(() => shape, "shape"),
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  static {
    __name(this, "ZodUnion");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    __name(handleResults, "handleResults");
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = /* @__PURE__ */ __name((type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
}, "getDiscriminator");
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  static {
    __name(this, "ZodDiscriminatedUnion");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
__name(mergeValues, "mergeValues");
var ZodIntersection = class extends ZodType {
  static {
    __name(this, "ZodIntersection");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = /* @__PURE__ */ __name((parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    }, "handleParsed");
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  static {
    __name(this, "ZodTuple");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  static {
    __name(this, "ZodRecord");
  }
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  static {
    __name(this, "ZodMap");
  }
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  static {
    __name(this, "ZodSet");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    __name(finalizeSet, "finalizeSet");
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  static {
    __name(this, "ZodFunction");
  }
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    __name(makeArgsIssue, "makeArgsIssue");
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    __name(makeReturnsIssue, "makeReturnsIssue");
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  static {
    __name(this, "ZodLazy");
  }
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  static {
    __name(this, "ZodLiteral");
  }
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
__name(createZodEnum, "createZodEnum");
var ZodEnum = class _ZodEnum extends ZodType {
  static {
    __name(this, "ZodEnum");
  }
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  static {
    __name(this, "ZodNativeEnum");
  }
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  static {
    __name(this, "ZodPromise");
  }
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  static {
    __name(this, "ZodEffects");
  }
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: /* @__PURE__ */ __name((arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      }, "addIssue"),
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = /* @__PURE__ */ __name((acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      }, "executeRefinement");
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  static {
    __name(this, "ZodOptional");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  static {
    __name(this, "ZodNullable");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  static {
    __name(this, "ZodDefault");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  static {
    __name(this, "ZodCatch");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  static {
    __name(this, "ZodNaN");
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  static {
    __name(this, "ZodBranded");
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  static {
    __name(this, "ZodPipeline");
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = /* @__PURE__ */ __name(async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      }, "handleAsync");
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  static {
    __name(this, "ZodReadonly");
  }
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = /* @__PURE__ */ __name((data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    }, "freeze");
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
__name(cleanParams, "cleanParams");
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
__name(custom, "custom");
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = /* @__PURE__ */ __name((cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params), "instanceOfType");
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = /* @__PURE__ */ __name(() => stringType().optional(), "ostring");
var onumber = /* @__PURE__ */ __name(() => numberType().optional(), "onumber");
var oboolean = /* @__PURE__ */ __name(() => booleanType().optional(), "oboolean");
var coerce = {
  string: /* @__PURE__ */ __name(((arg) => ZodString.create({ ...arg, coerce: true })), "string"),
  number: /* @__PURE__ */ __name(((arg) => ZodNumber.create({ ...arg, coerce: true })), "number"),
  boolean: /* @__PURE__ */ __name(((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })), "boolean"),
  bigint: /* @__PURE__ */ __name(((arg) => ZodBigInt.create({ ...arg, coerce: true })), "bigint"),
  date: /* @__PURE__ */ __name(((arg) => ZodDate.create({ ...arg, coerce: true })), "date")
};
var NEVER = INVALID;

// src/routes/support.ts
init_modules_watch_stub();
var PARSE_INT_MESSAGE = "Validation failed (numeric string is expected)";
async function parseDto(c, schema) {
  let raw2;
  try {
    raw2 = await c.req.json();
  } catch {
    throw new ApiHttpError(400, "Request body must be JSON");
  }
  const result = schema.safeParse(raw2);
  if (!result.success) {
    throw validationError(result.error);
  }
  return result.data;
}
__name(parseDto, "parseDto");
function validationError(error) {
  const message = error.issues.map((issue2) => issue2.message).join("; ");
  return new ApiHttpError(400, {
    statusCode: 400,
    message,
    error: "ValidationError"
  });
}
__name(validationError, "validationError");
function parseIntParam(c, name) {
  const raw2 = c.req.param(name) ?? "";
  const parsed = Number.parseInt(raw2, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw2) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: PARSE_INT_MESSAGE,
      error: "Bad Request"
    });
  }
  return parsed;
}
__name(parseIntParam, "parseIntParam");
function parseUuidParam(c, name) {
  const raw2 = c.req.param(name) ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw2)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: "Validation failed (uuid is expected)",
      error: "Bad Request"
    });
  }
  return raw2;
}
__name(parseUuidParam, "parseUuidParam");

// src/adapters/core-domain-bridge.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/governance/services/source-governance.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/governance/ports/source-governance-repository.port.ts
init_modules_watch_stub();
var SOURCE_GOVERNANCE_REPOSITORY_PORT = "SOURCE_GOVERNANCE_REPOSITORY_PORT";

// ../../packages/core-domain/src/governance/services/source-governance.service.ts
var SourceGovernanceService = class {
  constructor(repository) {
    this.repository = repository;
  }
  repository;
  logger = new Logger(SourceGovernanceService.name);
  /**
   * Register a new data source for a merchant.
   *
   * Creates a governance record that documents how the source data is
   * acquired and what its current permission status is.  New sources
   * are typically registered with PENDING status and transitioned to
   * GRANTED after a compliance review.
   *
   * @param merchantId       Stable merchant identifier.
   * @param acquisitionMethod How this source is acquired.
   * @param permissionStatus Initial permission status.
   * @param sourceUrl        URL or reference for the data origin.
   * @returns                The created governance record.
   */
  async registerSource(merchantId, acquisitionMethod, permissionStatus, sourceUrl) {
    const input = {
      merchantId,
      acquisitionMethod,
      permissionStatus,
      sourceUrl
    };
    const record = await this.repository.create(input);
    this.logger.log(
      `Registered source for merchant "${merchantId}": ${acquisitionMethod} (${permissionStatus})`
    );
    return record;
  }
  /**
   * Check the current permission status for a merchant.
   *
   * Aggregates across all registered sources.  Returns the most favourable
   * active status with warnings if any source has lapsed or been revoked.
   * Returns undefined when the merchant has no registered sources.
   */
  async checkPermission(merchantId) {
    return this.repository.checkPermission(merchantId);
  }
  /**
   * Revoke all permissions for a merchant.
   *
   * Marks every registered source for the merchant as REVOKED.  This is the
   * primary revocation method — used when a merchant agreement ends or a
   * compliance issue is discovered.
   *
   * @param merchantId Merchant whose sources should be revoked.
   * @param reason     Human-readable reason for the revocation.
   * @returns          Number of sources that were updated.
   */
  async revokePermission(merchantId, reason) {
    const count = await this.repository.revokeAllByMerchantId(
      merchantId,
      reason
    );
    this.logger.warn(
      `Permission revoked for merchant "${merchantId}" (${count} source(s)): ${reason}`
    );
    return count;
  }
  /**
   * Revoke a single source by its governance record ID.
   *
   * Useful for targeted revocation when only one source is non-compliant
   * while others remain GRANTED.
   *
   * @param id     ID of the governance record to revoke.
   * @param reason Human-readable reason for the revocation.
   */
  async revokeSourceById(id, reason) {
    const updated = await this.repository.updateStatus(id, "REVOKED", reason);
    if (updated) {
      this.logger.warn(
        `Source ${id} (merchant "${updated.merchantId}") revoked: ${reason}`
      );
    } else {
      this.logger.warn(
        `Attempted to revoke non-existent source governance record ${id}`
      );
    }
    return updated;
  }
  /**
   * List all registered data sources for a merchant.
   *
   * Returns records ordered by creation date descending (most recent first).
   */
  async listMerchantSources(merchantId) {
    return this.repository.findByMerchantId(merchantId);
  }
  /**
   * Find a single governance record by its ID.
   */
  async findById(id) {
    return this.repository.findById(id);
  }
};
__name(SourceGovernanceService, "SourceGovernanceService");
SourceGovernanceService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(SOURCE_GOVERNANCE_REPOSITORY_PORT))
], SourceGovernanceService);

// ../../packages/core-domain/src/reliability/reliability.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/reliability/reliability.types.ts
init_modules_watch_stub();
var RELIABILITY_ORDER = [
  "VERIFIED",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
];
var HOUR = { milliseconds: 36e5 };
var DAY = { milliseconds: 864e5 };
var DEFAULT_STALENESS_THRESHOLDS = {
  price: { milliseconds: 24 * HOUR.milliseconds },
  transport: { milliseconds: 7 * DAY.milliseconds },
  classification: { milliseconds: 30 * DAY.milliseconds }
};

// ../../packages/core-domain/src/reliability/reliability.service.ts
var ReliabilityService = class {
  // ---------------------------------------------------------------------------
  // Assessment
  // ---------------------------------------------------------------------------
  /**
   * Assess whether a data point has gone stale.
   *
   * Compares `observedAt` against the current time (`now`).  If the
   * elapsed time exceeds `stalenessThreshold` the status is `STALE`,
   * otherwise it is `VERIFIED`.
   *
   * @param observedAt          When the data point was last observed.
   * @param stalenessThreshold  Maximum acceptable age for the domain.
   * @returns                   `VERIFIED` if fresh, `STALE` if expired.
   */
  assessDataRecency(observedAt, stalenessThreshold, now = /* @__PURE__ */ new Date()) {
    const elapsed = now.getTime() - observedAt.getTime();
    return elapsed <= stalenessThreshold.milliseconds ? "VERIFIED" : "STALE";
  }
  /**
   * Assess whether data is actually present.
   *
   * @param data  The data point (or null/undefined).
   * @returns     `UNAVAILABLE` when data is null or undefined,
   *              otherwise `ESTIMATED` (caller may promote to VERIFIED
   *              after source-specific validation).
   */
  assessAvailability(data) {
    return data === null || data === void 0 ? "UNAVAILABLE" : "ESTIMATED";
  }
  // ---------------------------------------------------------------------------
  // Composition
  // ---------------------------------------------------------------------------
  /**
   * Compose multiple reliability statuses into a single result.
   *
   * Returns the **strictest** (most conservative) status among the inputs.
   * Ordering (least → most strict): VERIFIED → ESTIMATED → STALE → UNAVAILABLE.
   *
   * Use case: a calculation that reads price (VERIFIED) + transport (STALE)
   * should report STALE — the weakest link determines overall reliability.
   *
   * @param statuses  Non-empty array of statuses to compose.
   * @returns         The strictest status in the input set.
   */
  composeReliability(statuses) {
    if (statuses.length === 0) {
      return "UNAVAILABLE";
    }
    let strictestIndex = -1;
    for (const status of statuses) {
      const idx = RELIABILITY_ORDER.indexOf(status);
      if (idx > strictestIndex) {
        strictestIndex = idx;
      }
    }
    return RELIABILITY_ORDER[strictestIndex];
  }
  // ---------------------------------------------------------------------------
  // Threshold configuration
  // ---------------------------------------------------------------------------
  /**
   * Resolve the staleness threshold for a given domain.
   *
   * Overrides can be passed to allow runtime or environment-based
   * configuration.  Falls back to module-level defaults.
   *
   * @param domain    Domain identifier.
   * @param overrides Optional domain-specific overrides.
   * @returns         The effective staleness threshold.
   */
  stalenessThresholdFor(domain, overrides) {
    if (overrides?.[domain]) {
      return overrides[domain];
    }
    return DEFAULT_STALENESS_THRESHOLDS[domain];
  }
};
__name(ReliabilityService, "ReliabilityService");
ReliabilityService = __decorateClass([
  Injectable()
], ReliabilityService);

// ../../packages/core-domain/src/fx/fx-dataset.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/fx/fx-rate-window.ts
init_modules_watch_stub();
function resolveRateFromEntries(entries, dataset, baseCurrency, quoteCurrency) {
  const base = baseCurrency.trim().toUpperCase();
  const quote = quoteCurrency.trim().toUpperCase();
  const direct = entries.find(
    (e) => e.baseCurrency === base && e.quoteCurrency === quote
  );
  if (direct) {
    return {
      dataset,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: direct.rate,
      inverted: false
    };
  }
  const opposite = entries.find(
    (e) => e.baseCurrency === quote && e.quoteCurrency === base
  );
  if (oppositeUsable(opposite)) {
    return {
      dataset,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: 1 / opposite.rate,
      inverted: true
    };
  }
  return null;
}
__name(resolveRateFromEntries, "resolveRateFromEntries");
function oppositeUsable(entry) {
  return entry !== void 0 && entry.rate > 0;
}
__name(oppositeUsable, "oppositeUsable");

// ../../packages/core-domain/src/fx/ports/fx-rate-dataset-repository.port.ts
init_modules_watch_stub();
var FX_RATE_DATASET_REPOSITORY_PORT = "FX_RATE_DATASET_REPOSITORY_PORT";

// ../../packages/core-domain/src/fx/fx-dataset.service.ts
var FxDatasetVersionConflictError = class extends Error {
  static {
    __name(this, "FxDatasetVersionConflictError");
  }
  constructor(versionLabel) {
    super(`FX dataset version "${versionLabel}" already exists \u2014 datasets are append-only`);
    this.name = "FxDatasetVersionConflictError";
  }
};
var FxDatasetNotFoundError = class extends Error {
  static {
    __name(this, "FxDatasetNotFoundError");
  }
  constructor(datasetId) {
    super(`FX dataset ${datasetId} not found`);
    this.name = "FxDatasetNotFoundError";
  }
};
var FxDatasetInvalidTransitionError = class extends Error {
  static {
    __name(this, "FxDatasetInvalidTransitionError");
  }
  constructor(message) {
    super(message);
    this.name = "FxDatasetInvalidTransitionError";
  }
};
var InvalidFxDatasetInputError = class extends Error {
  static {
    __name(this, "InvalidFxDatasetInputError");
  }
  constructor(message) {
    super(message);
    this.name = "InvalidFxDatasetInputError";
  }
};
var FxRateDatasetService = class {
  constructor(repo) {
    this.repo = repo;
  }
  repo;
  // -------------------------------------------------------------------------
  // Version lifecycle
  // -------------------------------------------------------------------------
  /**
   * Create a new dataset version in PENDING_CONFIRMATION status.
   *
   * This is the ONLY creation path and it never publishes: the resulting
   * version becomes effective exclusively through
   * {@link confirmPublication} by a human operator. Rejects duplicate
   * version labels (append-only identity), empty or malformed payloads,
   * and ambiguous currency pairs.
   */
  async createPendingDataset(input) {
    const versionLabel = input.versionLabel.trim();
    if (versionLabel === "") {
      throw new InvalidFxDatasetInputError("versionLabel must not be empty");
    }
    if (input.sourceName.trim() === "") {
      throw new InvalidFxDatasetInputError("sourceName must not be empty");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)) {
      throw new InvalidFxDatasetInputError(
        `referenceDate "${input.referenceDate}" must be an ISO-8601 date (YYYY-MM-DD)`
      );
    }
    if (input.effectiveTo !== void 0 && input.effectiveTo !== null) {
      if (input.effectiveTo.getTime() <= input.effectiveFrom.getTime()) {
        throw new InvalidFxDatasetInputError(
          "effectiveTo must be strictly after effectiveFrom"
        );
      }
    }
    this.validateRates(input.rates);
    const existing = await this.repo.findDatasetByVersionLabel(versionLabel);
    if (existing !== null) {
      throw new FxDatasetVersionConflictError(versionLabel);
    }
    return this.repo.createDataset({
      ...input,
      versionLabel,
      sourceName: input.sourceName.trim()
    });
  }
  /**
   * Publish a dataset version — the explicit manual-confirmation step.
   *
   * The only PENDING_CONFIRMATION → PUBLISHED transition in the system.
   * `confirmedBy` is mandatory: an unattributed confirmation is not a
   * confirmation. No other service method calls the repository's publish.
   */
  async confirmPublication(datasetId, confirmedBy) {
    const operator = confirmedBy.trim();
    if (operator === "") {
      throw new FxDatasetInvalidTransitionError(
        "confirmPublication requires a non-empty confirmedBy operator"
      );
    }
    const published = await this.repo.publishDataset(datasetId, operator);
    if (published === null) {
      const dataset = await this.repo.findDatasetById(datasetId);
      if (dataset === null) throw new FxDatasetNotFoundError(datasetId);
      throw new FxDatasetInvalidTransitionError(
        `FX dataset ${datasetId} (${dataset.versionLabel}) is ${dataset.status}; only a PENDING_CONFIRMATION dataset can be published`
      );
    }
    return published;
  }
  /** Versions awaiting operator confirmation (the review queue). */
  async listPendingDatasets() {
    return this.repo.findPendingDatasets();
  }
  /** A dataset version by label, null when absent. */
  async getDatasetByVersion(versionLabel) {
    return this.repo.findDatasetByVersionLabel(versionLabel);
  }
  // -------------------------------------------------------------------------
  // Rate resolution
  // -------------------------------------------------------------------------
  /**
   * Resolve the conversion rate for a pair as of an observation date.
   *
   * Uses the PUBLISHED dataset effective on `asOf` — not the newest
   * dataset — so a past-dated offer converts at the rate that was in
   * force when it was observed. Returns null when no published dataset
   * covers the date or the pair is absent; callers must reject the
   * conversion, never fall back to 1:1.
   */
  async resolveRate(baseCurrency, quoteCurrency, asOf) {
    const dataset = await this.repo.findPublishedDatasetEffectiveOn(asOf);
    if (dataset === null) return null;
    const entries = await this.repo.findRatesForDataset(dataset.id);
    return resolveRateFromEntries(entries, dataset, baseCurrency, quoteCurrency);
  }
  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------
  validateRates(rates) {
    if (rates.length === 0) {
      throw new InvalidFxDatasetInputError("a dataset must carry at least one rate");
    }
    const seen = /* @__PURE__ */ new Set();
    for (const rate of rates) {
      const base = rate.baseCurrency.trim().toUpperCase();
      const quote = rate.quoteCurrency.trim().toUpperCase();
      if (base.length !== 3 || quote.length !== 3) {
        throw new InvalidFxDatasetInputError(
          `currency pair ${rate.baseCurrency}/${rate.quoteCurrency} is not ISO-4217 alpha-3`
        );
      }
      if (base === quote) {
        throw new InvalidFxDatasetInputError(`self-pair ${base}/${quote} is meaningless`);
      }
      if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
        throw new InvalidFxDatasetInputError(
          `rate for ${base}/${quote} must be a positive number, got ${rate.rate}`
        );
      }
      for (const key of [`${base}/${quote}`, `${quote}/${base}`]) {
        if (seen.has(key)) {
          throw new InvalidFxDatasetInputError(
            `duplicate currency pair ${key} \u2014 one row per pair per version`
          );
        }
      }
      seen.add(`${base}/${quote}`);
    }
  }
};
__name(FxRateDatasetService, "FxRateDatasetService");
FxRateDatasetService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(FX_RATE_DATASET_REPOSITORY_PORT))
], FxRateDatasetService);

// ../../packages/core-domain/src/fx/fx-dataset.types.ts
init_modules_watch_stub();
var FX_DATASET_STATUSES = [
  "PENDING_CONFIRMATION",
  "PUBLISHED"
];

// ../../packages/core-domain/src/normalization/source-category.mapper.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/tax/tax-categories.ts
init_modules_watch_stub();
var TAX_TYPES = {
  excise: "excise",
  containerDuty: "container_duty"
};
var TAX_CATEGORY_KEYS = [
  "beer",
  "wine_still",
  "wine_sparkling",
  "spirits",
  "intermediate_products",
  "other_fermented"
];

// ../../packages/core-domain/src/normalization/normalization.service.ts
init_modules_watch_stub();
var UNIT_TO_LITRES = {
  L: 1,
  ml: 1e-3,
  cl: 0.01,
  dl: 0.1,
  gal: 3.78541,
  floz: 0.0295735
};
function normalizeBrandName(raw2) {
  const trimmed = raw2.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.split(/\s+/).map(titleCaseWord).join(" ");
}
__name(normalizeBrandName, "normalizeBrandName");
function titleCaseWord(word) {
  if (word.length === 0) return word;
  const lower = word.toLowerCase();
  const oApostrophe = lower.startsWith("o'");
  const mcPrefix = lower.startsWith("mc");
  const macPrefix = lower.startsWith("mac");
  if (oApostrophe && word.length > 2) {
    return `O'${word.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  if (mcPrefix && word.length > 2) {
    return `Mc${word.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  if (macPrefix && word.length > 3) {
    return `Mac${word.charAt(3).toUpperCase()}${lower.slice(4)}`;
  }
  return word.charAt(0).toUpperCase() + lower.slice(1);
}
__name(titleCaseWord, "titleCaseWord");
function normalizeCategory(raw2) {
  const key = raw2.toLowerCase().trim();
  switch (key) {
    // Beer
    case "beer":
    case "olut":
    case "ale":
    case "lager":
    case "stout":
    case "porter":
    case "ipa":
    case "pilsner":
    case "vehn\xE4":
    case "weizen":
      return "beer";
    // Cider
    case "cider":
    case "siideri":
    case "hard cider":
      return "cider";
    // Wine
    case "wine":
    case "viini":
    case "red wine":
    case "white wine":
    case "ros\xE9":
    case "rose":
    case "rose wine":
      return "wine";
    // Sparkling wine
    case "sparkling wine":
    case "sparkling-wine":
    case "champagne":
    case "kuohuviini":
    case "samppanja":
    case "prosecco":
    case "cava":
      return "sparkling-wine";
    // Fortified wine
    case "fortified wine":
    case "fortified-wine":
    case "port":
    case "portviini":
    case "sherry":
    case "madeira":
    case "vermouth":
      return "fortified-wine";
    // Spirits
    case "spirits":
    case "viina":
    case "vodka":
    case "whisky":
    case "whiskey":
    case "gin":
    case "rum":
    case "tequila":
    case "brandy":
    case "cognac":
    case "aquavit":
    case "akvaviitti":
    case "lik\xF6\xF6ri":
    case "bitters":
      return "spirits";
    // Liqueur
    case "liqueur":
    case "liquer":
    case "cream liqueur":
      return "liqueur";
    // Long drink / RTD
    case "long drink":
    case "long-drink":
    case "lonkero":
    case "rtd":
    case "ready-to-drink":
    case "mixed drink":
    case "cocktail":
      return "long-drink";
    // Sake
    case "sake":
    case "sak\xE9":
    case "sake rice wine":
      return "sake";
    // Non-alcoholic
    case "non-alcoholic":
    case "non alcoholic":
    case "alkoholiton":
    case "alcohol-free":
    case "alcohol free":
    case "0.0":
    case "0.0%":
    case "low alcohol":
    case "mieto":
      return "non-alcoholic";
    default:
      return "other";
  }
}
__name(normalizeCategory, "normalizeCategory");
function standardizeVolume(volume, unit = "L") {
  if (volume < 0) {
    throw new RangeError(`Volume must not be negative, got ${volume}`);
  }
  const factor = UNIT_TO_LITRES[unit];
  if (factor === void 0) {
    throw new RangeError(`Unknown volume unit "${unit}"`);
  }
  return volume * factor;
}
__name(standardizeVolume, "standardizeVolume");
function validateAbv(abv) {
  if (abv < 0 || abv > 100) {
    throw new RangeError(`ABV must be between 0 and 100, got ${abv}`);
  }
  return abv;
}
__name(validateAbv, "validateAbv");
function standardizeContainerType(raw2) {
  const key = raw2.toLowerCase().trim();
  if (key.includes("glass") || key.includes("bottle") || key === "pullo" || key === "lasi") {
    if (key.includes("plastic")) return "plastic-bottle";
    return "glass-bottle";
  }
  if (key.includes("plastic") || key.includes("pet") || key.includes("muovi") || key.includes("muovipullo")) {
    return "plastic-bottle";
  }
  if (key.includes("can") || key.includes("tin") || key.includes("aluminum") || key.includes("aluminium") || key.includes("t\xF6lkki") || key === "metal") {
    return "metal-can";
  }
  if (key.includes("carton") || key.includes("tetra") || key.includes("tetrapak") || key.includes("kartonki")) {
    return "carton";
  }
  if (key.includes("bag-in-box") || key.includes("bag in box") || key.includes("bib") || key.includes("laatikko")) {
    return "bag-in-box";
  }
  if (key.includes("keg") || key.includes("tynnyri") || key.includes("barrel")) {
    return "keg";
  }
  if (key.includes("pouch") || key.includes("pussi") || key.includes("doypack")) {
    return "pouch";
  }
  return "other";
}
__name(standardizeContainerType, "standardizeContainerType");
function cleanText(raw2) {
  return raw2.trim().replace(/\s+/g, " ");
}
__name(cleanText, "cleanText");
var NormalizationService = class {
  /**
   * Normalize a single raw product record into its canonical form.
   *
   * This is a pure function: given the same input it always produces the same
   * output, with no I/O or side effects.
   */
  normalize(raw2) {
    const warnings = [];
    const normalizedBrand = normalizeBrandName(raw2.brand);
    const canonicalCategory = normalizeCategory(raw2.category);
    const unit = raw2.volumeUnit ?? "L";
    let volumeLitres;
    try {
      volumeLitres = standardizeVolume(raw2.volume, unit);
    } catch (e) {
      throw new Error(
        `Volume normalisation failed: ${e.message}`
      );
    }
    let alcoholByVolume = 0;
    if (raw2.abv !== void 0 && raw2.abv !== null) {
      try {
        alcoholByVolume = validateAbv(raw2.abv);
      } catch (e) {
        alcoholByVolume = 0;
        warnings.push(
          `ABV ${raw2.abv} is invalid (${e.message}); clamped to 0`
        );
      }
    }
    const containerType = raw2.packaging ? standardizeContainerType(raw2.packaging) : "other";
    if (raw2.packaging && containerType === "other") {
      warnings.push(
        `Unrecognised packaging "${raw2.packaging}" mapped to 'other'`
      );
    }
    const name = cleanText(raw2.name);
    const description = raw2.description ? cleanText(raw2.description) : "";
    const ean = raw2.ean?.trim() ?? null;
    const images = raw2.images ?? [];
    return {
      normalizedName: name,
      normalizedBrand,
      canonicalCategory,
      volumeLitres,
      alcoholByVolume,
      containerType,
      ean,
      images,
      description,
      originalInput: raw2,
      normalizationWarnings: warnings
    };
  }
};
__name(NormalizationService, "NormalizationService");
NormalizationService = __decorateClass([
  Injectable()
], NormalizationService);

// ../../packages/core-domain/src/normalization/source-category.mapper.ts
var SWEDISH_SOURCE_CATEGORY_MAP = {
  // Produktgrupp:Öl
  "\xF6l": "beer",
  // Produktgrupp:Vin
  "vin": "wine",
  "r\xF6tt vin": "wine",
  "vitt vin": "wine",
  "ros\xE9vin": "wine",
  "rosevin": "wine",
  // Mousserande
  "mousserande vin": "sparkling-wine",
  mousserande: "sparkling-wine",
  // Produktgrupp:Sprit
  sprit: "spirits",
  lik\u00F6r: "liqueur",
  // Starkvin / aperitif-desserter — fortified & aromatised wines
  starkvin: "fortified-wine",
  aperitif: "fortified-wine",
  "aperitif och dessert": "fortified-wine",
  gl\u00F6gg: "fortified-wine",
  // Produktgrupp:Cider och blanddrycker
  cider: "cider",
  "cider och blanddrycker": "cider",
  "cider & blanddrycker": "cider",
  // Rice wine
  sake: "sake",
  // Alkoholfritt assortment group
  alkoholfritt: "non-alcoholic",
  alkoholfri: "non-alcoholic"
};
var EXPLICIT_OTHER_TOKENS = /* @__PURE__ */ new Set([
  "other",
  "annat",
  // SE
  "muu"
  // FI
]);
var CANONICAL_TO_TAX_CATEGORY = {
  beer: "beer",
  wine: "wine_still",
  "sparkling-wine": "wine_sparkling",
  "fortified-wine": "intermediate_products",
  spirits: "spirits",
  liqueur: "spirits",
  cider: "other_fermented",
  "long-drink": "other_fermented",
  sake: "other_fermented",
  // Every category's lowest ABV band is zero-rated, so the tax-key for a
  // 0.0 % product is numerically inert; other_fermented is the taxonomy's
  // catch-all for non-beer/wine/spirits fermented and alcohol-free drinks.
  "non-alcoholic": "other_fermented",
  other: "other_fermented"
};
function mapSourceCategory(raw2) {
  const key = raw2.trim().toLowerCase();
  if (key === "") return null;
  const canonicalCategory = SWEDISH_SOURCE_CATEGORY_MAP[key] ?? normalizeCategory(key);
  if (canonicalCategory === "other" && !EXPLICIT_OTHER_TOKENS.has(key)) {
    return null;
  }
  const taxCategory = CANONICAL_TO_TAX_CATEGORY[canonicalCategory];
  return { canonicalCategory, taxCategory };
}
__name(mapSourceCategory, "mapSourceCategory");

// ../../packages/core-domain/src/normalization/classification-gate.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/normalization/normalization.types.ts
init_modules_watch_stub();
var CANONICAL_CATEGORY_KEYS = [
  "beer",
  "cider",
  "wine",
  "sparkling-wine",
  "fortified-wine",
  "spirits",
  "liqueur",
  "long-drink",
  "sake",
  "non-alcoholic",
  "other"
];
var KNOWN_REGULATORY_CLASSIFICATIONS = /* @__PURE__ */ new Set([
  ...CANONICAL_CATEGORY_KEYS,
  ...TAX_CATEGORY_KEYS,
  // Legacy broad classes in seeded product data (ExciseCategory members
  // that predate the canonical vocabulary).
  "wine",
  "intermediate",
  "other"
]);
var REGULATORY_CLASSIFICATION_PLACEHOLDER = "unknown";

// ../../packages/core-domain/src/normalization/classification-gate.service.ts
var ClassificationGateService = class {
  /**
   * Check whether a product passes the classification gate.
   *
   * A product passes iff its `regulatoryClassification` is a non-empty,
   * case-insensitive member of the known classification vocabulary.
   * The placeholder value 'unknown' and every other non-member are
   * rejected with a distinct reason.
   *
   * This is a pure synchronous function — no I/O, no side effects.
   */
  checkProductGate(product) {
    if (product.regulatoryClassification === null || product.regulatoryClassification === void 0) {
      return {
        passed: false,
        reason: "Product lacks regulatory classification"
      };
    }
    const trimmed = product.regulatoryClassification.trim();
    if (trimmed === "") {
      return {
        passed: false,
        reason: "Product lacks regulatory classification"
      };
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === REGULATORY_CLASSIFICATION_PLACEHOLDER) {
      return {
        passed: false,
        reason: 'regulatoryClassification "unknown" is a placeholder, not a classification'
      };
    }
    if (!KNOWN_REGULATORY_CLASSIFICATIONS.has(normalized)) {
      return {
        passed: false,
        reason: `regulatoryClassification "${trimmed}" is not a member of the known classification enum`
      };
    }
    return { passed: true };
  }
};
__name(ClassificationGateService, "ClassificationGateService");
ClassificationGateService = __decorateClass([
  Injectable()
], ClassificationGateService);

// ../../packages/core-domain/src/tax/services/alcohol-excise.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/tax/services/alcohol-excise.math.ts
init_modules_watch_stub();
var FORMULA_PER_LITRE_OF_PRODUCT = "PER_LITRE_OF_PRODUCT";
var FORMULA_PER_LITRE_OF_ALCOHOL = "PER_LITRE_OF_ALCOHOL";
var FORMULA_PER_CENTILITRE_ETHANOL = "PER_CENTILITRE_ETHANOL";
var DEFAULT_RATES = {
  beer: { formula: FORMULA_PER_CENTILITRE_ETHANOL, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" },
  wine_still: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" },
  wine_sparkling: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" },
  spirits: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" },
  intermediate_products: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" },
  other_fermented: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0, note: "NO_FALLBACK \u2014 rate 0, reliability ESTIMATED" }
};
function normaliseCategory(raw2) {
  const lower = raw2.toLowerCase().trim();
  switch (lower) {
    // Canonical keys (idempotent passthrough)
    case "beer":
    case "wine_still":
    case "wine_sparkling":
    case "spirits":
    case "intermediate_products":
    case "other_fermented":
      return lower;
    // Finnish / common aliases
    case "olut":
      return "beer";
    case "wine":
    case "viini":
      return "wine_still";
    case "sparkling":
    case "champagne":
    case "kuohuviini":
      return "wine_sparkling";
    case "viina":
    case "vodka":
    case "whisky":
    case "whiskey":
      return "spirits";
    case "cider":
    case "siideri":
    case "rtd":
    case "ready-to-drink":
    case "lonkero":
      return "other_fermented";
    case "intermediate":
    case "v\xE4li":
    case "portviini":
    case "sherry":
      return "intermediate_products";
    default:
      return "other_fermented";
  }
}
__name(normaliseCategory, "normaliseCategory");
function resolveOtherFermentedFormula(_rawCategory) {
  return "PER_LITRE_OF_PRODUCT";
}
__name(resolveOtherFermentedFormula, "resolveOtherFermentedFormula");
function calcPerLitreOfProduct(ratePerLitre, volumeLitres) {
  validatePositive(volumeLitres, "volumeLitres");
  const amount = ratePerLitre * volumeLitres;
  return roundToCents(amount);
}
__name(calcPerLitreOfProduct, "calcPerLitreOfProduct");
function calcPerLitreOfAlcohol(ratePerAlcoholLitre, abv, volumeLitres) {
  validatePositive(volumeLitres, "volumeLitres");
  validateRange(abv, 0, 1, "abv");
  const pureAlcoholLitres = abv * volumeLitres;
  const amount = ratePerAlcoholLitre * pureAlcoholLitres;
  return roundToCents(amount);
}
__name(calcPerLitreOfAlcohol, "calcPerLitreOfAlcohol");
function calcPerDegreePlato(ratePerCentilitreEthanol, abv, volumeLitres) {
  validatePositive(volumeLitres, "volumeLitres");
  validateRange(abv, 0, 1, "abv");
  const amount = ratePerCentilitreEthanol * abv * volumeLitres;
  return roundToCents(amount);
}
__name(calcPerDegreePlato, "calcPerDegreePlato");
function calculateAlcoholExcise(formulaRef, rateValue, abv, volumeLitres, _category) {
  switch (formulaRef) {
    case FORMULA_PER_LITRE_OF_ALCOHOL: {
      const taxCents = calcPerLitreOfAlcohol(rateValue, abv, volumeLitres);
      const effectiveRate = rateValue * abv;
      return { taxCents, rateApplied: effectiveRate };
    }
    case FORMULA_PER_CENTILITRE_ETHANOL:
    case "PER_DEGREE_PLATO": {
      const taxCents = calcPerDegreePlato(rateValue, abv, volumeLitres);
      const effectiveRate = rateValue * abv;
      return { taxCents, rateApplied: effectiveRate };
    }
    case FORMULA_PER_LITRE_OF_PRODUCT:
    default: {
      const taxCents = calcPerLitreOfProduct(rateValue, volumeLitres);
      return { taxCents, rateApplied: rateValue };
    }
  }
}
__name(calculateAlcoholExcise, "calculateAlcoholExcise");
function validatePositive(value, name) {
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}
__name(validatePositive, "validatePositive");
function validateRange(value, min, max, name) {
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}
__name(validateRange, "validateRange");
function roundToCents(amount) {
  return Math.round(amount * 100);
}
__name(roundToCents, "roundToCents");

// ../../packages/core-domain/src/tax/services/alcohol-excise.service.ts
var TAX_RULE_REPOSITORY_PORT = "TAX_RULE_REPOSITORY_PORT";
var AlcoholExciseService = class {
  constructor(taxRepo) {
    this.taxRepo = taxRepo;
  }
  taxRepo;
  /**
   * Calculate excise duty for a beverage.
   *
   * @param category      Product category (beer, wine, spirits, cider, rtd, intermediate, other).
   * @param abv           Alcohol by volume as a decimal fraction (0–1, e.g. 0.40 for 40 %).
   * @param volumeLitres  Volume in litres.
   * @param asOf          Optional effective-date lookup (defaults to now).
   */
  async calculate(category, abv, volumeLitres, asOf) {
    const lookupDate = asOf ?? /* @__PURE__ */ new Date();
    const normalised = normaliseCategory(category);
    const rules = await this.taxRepo.findAllApplicable(
      TAX_TYPES.excise,
      normalised,
      lookupDate
    );
    if (rules.length > 0) {
      const matchedRule = this.findMatchingRule(rules, abv);
      if (matchedRule) {
        return this.computeFromRule(matchedRule, normalised, abv, volumeLitres, category);
      }
      return this.computeFromRule(rules[0], normalised, abv, volumeLitres, category);
    }
    return this.computeFallback(normalised, abv, volumeLitres);
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  /**
   * Select the rule whose ABV tier matches the product's ABV.
   *
   * ABV tiers are defined by {@code exemptionConditions}:
   * - `maxAlcoholByVolume` alone (no `minAlcoholByVolume`):
   *   exemption tier — ABV ≤ threshold.  Exemption is only applied when
   *   the rule's rate is "0.00" (see {@link isExempt}).
   * - `minAlcoholByVolume` alone: ABV ≥ threshold.
   * - Both: ABV within [min, max].
   * - Neither: catch-all (no ABV constraints).
   *
   * @param rules  All active rules for the category, ordered by effectiveFrom desc.
   * @param abv    Product ABV as a decimal fraction (0–1).
   * @returns The matching rule, or null if none match.
   */
  findMatchingRule(rules, abv) {
    const abvPct = abv * 100;
    for (const rule of rules) {
      const cond = rule.exemptionConditions;
      if (!cond) {
        return rule;
      }
      if (this.matchesTier(cond, abvPct)) {
        return rule;
      }
    }
    return null;
  }
  /**
   * Check whether a product with the given ABV (in percentage) falls within
   * the tier defined by {@code conditions}.
   */
  matchesTier(conditions, abvPct) {
    const { minAlcoholByVolume: min, maxAlcoholByVolume: max } = conditions;
    if (min !== void 0 && max !== void 0) {
      return abvPct >= min && abvPct <= max;
    }
    if (min !== void 0) {
      return abvPct >= min;
    }
    if (max !== void 0) {
      return abvPct <= max;
    }
    return true;
  }
  /**
   * Determine whether the product is exempt from excise duty based on the
   * rule's rate and exemption conditions.
   *
   * A rule is exempt ONLY when its rate is "0.00" AND the ABV falls within
   * the exemption threshold (maxAlcoholByVolume alone, no minAlcoholByVolume).
   *
   * Rules with non-zero rates are never exempt — their `maxAlcoholByVolume`
   * is a tier boundary, not an exemption threshold.
   */
  isExempt(rule, abvPct) {
    if (rule.rate !== "0.00") return false;
    const cond = rule.exemptionConditions;
    if (!cond) return false;
    if (cond.maxAlcoholByVolume !== void 0 && cond.minAlcoholByVolume === void 0) {
      return abvPct <= cond.maxAlcoholByVolume;
    }
    return false;
  }
  computeFromRule(rule, category, abv, volumeLitres, originalCategory) {
    const abvPct = abv * 100;
    if (this.isExempt(rule, abvPct)) {
      const reliability2 = rule.verificationDate !== null ? "VERIFIED" : "ESTIMATED";
      return {
        category,
        abv,
        volumeLitres,
        rateApplied: 0,
        taxCents: 0,
        taxDatasetVersion: rule.versionLabel,
        reliability: reliability2,
        ruleId: rule.id
      };
    }
    const formulaRef = category === "other_fermented" && originalCategory ? resolveOtherFermentedFormula(originalCategory) : rule.calculationFormulaReference;
    const rateNumeric = parseDecimal(rule.rate);
    const { taxCents, rateApplied } = calculateAlcoholExcise(
      formulaRef,
      rateNumeric,
      abv,
      volumeLitres,
      category
    );
    const reliability = rule.verificationDate !== null ? "VERIFIED" : "ESTIMATED";
    return {
      category,
      abv,
      volumeLitres,
      rateApplied,
      taxCents,
      taxDatasetVersion: rule.versionLabel,
      reliability,
      ruleId: rule.id
    };
  }
  computeFallback(category, abv, volumeLitres) {
    const defaults = DEFAULT_RATES[category] ?? DEFAULT_RATES.other_fermented;
    const { taxCents, rateApplied } = calculateAlcoholExcise(
      defaults.formula,
      defaults.rate,
      abv,
      volumeLitres,
      category
    );
    return {
      category,
      abv,
      volumeLitres,
      rateApplied,
      taxCents,
      taxDatasetVersion: "FALLBACK",
      reliability: "ESTIMATED",
      ruleId: null
    };
  }
};
__name(AlcoholExciseService, "AlcoholExciseService");
AlcoholExciseService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(TAX_RULE_REPOSITORY_PORT))
], AlcoholExciseService);
function parseDecimal(value) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new TypeError(`Cannot parse tax rate as decimal: "${value}"`);
  }
  return n;
}
__name(parseDecimal, "parseDecimal");

// ../../packages/core-domain/src/tax/services/container-duty.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/tax/services/container-duty.math.ts
init_modules_watch_stub();
var DEFAULT_CONTAINER_DUTY_RATE = 0.51;
var STANDARD_CONTAINERS = /* @__PURE__ */ new Set([
  "glass",
  "plastic",
  "metal",
  "aluminium",
  "can",
  "carton",
  "tetra"
]);
function normalisePackaging(raw2) {
  return raw2.toLowerCase().trim();
}
__name(normalisePackaging, "normalisePackaging");
function isStandardPackaging(packaging) {
  return STANDARD_CONTAINERS.has(normalisePackaging(packaging));
}
__name(isStandardPackaging, "isStandardPackaging");
function calcContainerDuty(ratePerLitre, volumeLitres) {
  if (volumeLitres < 0) {
    throw new RangeError(`volumeLitres must not be negative, got ${volumeLitres}`);
  }
  return Math.round(ratePerLitre * volumeLitres * 100);
}
__name(calcContainerDuty, "calcContainerDuty");
function calculateContainerDuty(ratePerLitre, volumeLitres) {
  const dutyCents = calcContainerDuty(ratePerLitre, volumeLitres);
  return { dutyCents, rateApplied: ratePerLitre };
}
__name(calculateContainerDuty, "calculateContainerDuty");

// ../../packages/core-domain/src/tax/services/deposit-checker.ts
init_modules_watch_stub();
function checkDepositExemption(depositSystemStatus) {
  if (depositSystemStatus === true) {
    return {
      exempted: true,
      reason: "exempted \u2014 packaging participates in Finnish deposit-return system",
      reliability: "VERIFIED"
    };
  }
  if (depositSystemStatus === false) {
    return {
      exempted: false,
      reason: "applied \u2014 packaging does not participate in Finnish deposit-return system",
      reliability: "VERIFIED"
    };
  }
  return {
    exempted: false,
    reason: "estimated \u2014 deposit status could not be determined, assuming standard rate",
    reliability: "ESTIMATED"
  };
}
__name(checkDepositExemption, "checkDepositExemption");

// ../../packages/core-domain/src/tax/services/container-duty.service.ts
var ContainerDutyService = class {
  constructor(taxRepo) {
    this.taxRepo = taxRepo;
  }
  taxRepo;
  /**
     * Calculate container duty for a beverage.
     *
     * @param volumeLitres          Container volume in litres.
     * @param packaging             Packaging type string (e.g. "glass", "plastic", "keg").
     * @param depositSystemStatus   Optional. `true` if packaging participates in
     *                              the Finnish deposit-return system, `false` if not,
     *                              `null` (or omitted) if unknown.  When omitted,
     *                              defaults to `null`, which triggers ESTIMATED status.
     * @param asOf                  Optional effective-date lookup (defaults to now).
     *                              Historical dates resolve against the rate version
     *                              effective on that date.
     */
  async calculate(volumeLitres, packaging, depositSystemStatus = null, asOf) {
    const depositCheck = checkDepositExemption(depositSystemStatus);
    if (depositCheck.exempted) {
      return {
        volumeLitres,
        ratePerLitre: 0,
        dutyCents: 0,
        taxDatasetVersion: "EXEMPTED",
        reliability: depositCheck.reliability,
        ruleId: null,
        depositExemption: depositCheck
      };
    }
    const normalised = normalisePackaging(packaging);
    const lookupDate = asOf ?? /* @__PURE__ */ new Date();
    const rule = await this.taxRepo.findApplicable(
      "container_duty",
      "all_beverages",
      lookupDate
    );
    if (rule) {
      return this.computeFromRule(rule, volumeLitres, normalised, depositCheck);
    }
    return this.computeFallback(volumeLitres, normalised, depositCheck);
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  computeFromRule(rule, volumeLitres, packaging, depositCheck) {
    const rateNumeric = parseDecimal2(rule.rate);
    const { dutyCents, rateApplied } = calculateContainerDuty(
      rateNumeric,
      volumeLitres
    );
    const reliability = rule.verificationDate !== null && depositCheck.reliability === "VERIFIED" && isStandardPackaging(packaging) ? "VERIFIED" : "ESTIMATED";
    return {
      volumeLitres,
      ratePerLitre: rateApplied,
      dutyCents,
      taxDatasetVersion: rule.versionLabel,
      reliability,
      ruleId: rule.id,
      depositExemption: depositCheck
    };
  }
  computeFallback(volumeLitres, _packaging, depositCheck) {
    const { dutyCents, rateApplied } = calculateContainerDuty(
      DEFAULT_CONTAINER_DUTY_RATE,
      volumeLitres
    );
    return {
      volumeLitres,
      ratePerLitre: rateApplied,
      dutyCents,
      taxDatasetVersion: "FALLBACK",
      reliability: "ESTIMATED",
      // no verified rule → always ESTIMATED
      ruleId: null,
      depositExemption: depositCheck
    };
  }
};
__name(ContainerDutyService, "ContainerDutyService");
ContainerDutyService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject("TAX_RULE_REPOSITORY_PORT"))
], ContainerDutyService);
function parseDecimal2(value) {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new TypeError(`Cannot parse tax rate as decimal: "${value}"`);
  }
  return n;
}
__name(parseDecimal2, "parseDecimal");

// ../../packages/core-domain/src/transport/transport-estimation.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/transport/transport-offer-query.interface.ts
init_modules_watch_stub();
var TRANSPORT_OFFER_QUERY = "TRANSPORT_OFFER_QUERY";

// ../../packages/core-domain/src/transport/bracket-selection.ts
init_modules_watch_stub();
function inBracket(offer, weightKg) {
  const { minKg, maxKg } = offer.weightBracket;
  if (minKg !== null && weightKg < minKg) return false;
  if (maxKg !== null && weightKg > maxKg) return false;
  return true;
}
__name(inBracket, "inBracket");
function closestBracket(offers, weightKg) {
  let best = null;
  let bestDistance = Infinity;
  for (const offer of offers) {
    const { minKg, maxKg } = offer.weightBracket;
    let mid;
    if (minKg !== null && maxKg !== null) {
      mid = (minKg + maxKg) / 2;
    } else if (minKg !== null) {
      mid = minKg;
    } else if (maxKg !== null) {
      mid = maxKg;
    } else {
      mid = weightKg;
    }
    const distance = Math.abs(weightKg - mid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = offer;
    }
  }
  return best;
}
__name(closestBracket, "closestBracket");
function selectBestBracketOffer(candidates, weightKg) {
  if (candidates.length === 0) return null;
  const exact = candidates.find((o) => inBracket(o, weightKg));
  if (exact) {
    return { offer: exact, reliability: "EXACT" };
  }
  const closest = closestBracket(candidates, weightKg);
  return { offer: closest, reliability: "ESTIMATED" };
}
__name(selectBestBracketOffer, "selectBestBracketOffer");

// ../../packages/core-domain/src/transport/transport-estimation.service.ts
var TransportEstimationService = class {
  constructor(offerQuery) {
    this.offerQuery = offerQuery;
  }
  offerQuery;
  /**
   * Find the single best-matching transport offer for the given parameters.
   *
   * Matching criteria (strict):
   *   1. Carrier matches
   *   2. Origin country matches
   *   3. Destination country matches
   *   4. Package tier matches
   *   5. Weight falls within the offer's weight bracket
   *
   * If no weight bracket matches exactly the result carries
   * `reliabilityStatus: 'ESTIMATED'` and uses the closest bracket.
   * An exact weight match carries `reliabilityStatus: 'VERIFIED'`.
   */
  async estimate(carrier, origin, destination, weightKg, packageType) {
    const offers = await this.offerQuery.findByCarrier(carrier);
    const candidates = offers.filter(
      (o) => o.originCountry === origin && o.destinationCountry === destination && o.packageTier === packageType
    );
    if (candidates.length === 0) {
      throw new NotFoundError(carrier, origin, destination, packageType);
    }
    const selection = selectBestBracketOffer(candidates, weightKg);
    return {
      offer: selection.offer,
      matchedWeightBracket: selection.offer.weightBracket,
      reliabilityStatus: selection.reliability === "EXACT" ? "VERIFIED" : "ESTIMATED"
    };
  }
  /**
   * Returns all transport offers for a given carrier + route.
   * Filters by origin and destination; returns across all weight tiers
   * and package tiers.
   */
  async findOffers(carrier, origin, destination) {
    const offers = await this.offerQuery.findByCarrier(carrier);
    return offers.filter(
      (o) => o.originCountry === origin && o.destinationCountry === destination
    );
  }
};
__name(TransportEstimationService, "TransportEstimationService");
TransportEstimationService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(TRANSPORT_OFFER_QUERY))
], TransportEstimationService);
var NotFoundError = class extends Error {
  static {
    __name(this, "NotFoundError");
  }
  carrier;
  origin;
  destination;
  packageType;
  constructor(carrier, origin, destination, packageType) {
    super(
      `No transport offers found for carrier="${carrier}" route=${origin}\u2192${destination} package="${packageType}"`
    );
    this.name = "NotFoundError";
    this.carrier = carrier;
    this.origin = origin;
    this.destination = destination;
    this.packageType = packageType;
  }
};

// ../../packages/core-domain/src/reliability/confidence-framework.service.ts
init_modules_watch_stub();
var STATUS_DETAIL = {
  VERIFIED: "Data point is verified against an authoritative source.",
  ESTIMATED: "Data point is estimated from incomplete or indirect data.",
  STALE: "Data point has exceeded its freshness threshold.",
  UNAVAILABLE: "No data is available for this data point."
};
var ConfidenceFrameworkService = class {
  constructor(reliabilityService) {
    this.reliabilityService = reliabilityService;
  }
  reliabilityService;
  // ---------------------------------------------------------------------------
  // Aggregate confidence
  // ---------------------------------------------------------------------------
  /**
   * Compute the aggregate confidence level from a set of reliability statuses.
   *
   * Rules:
   * - **HIGH**   — all statuses are VERIFIED.
   * - **MEDIUM** — one or more statuses are ESTIMATED, and none are
   *                STALE or UNAVAILABLE.
   * - **LOW**    — one or more statuses are STALE or UNAVAILABLE.
   *
   * @param inputStatuses  Reliability statuses for each constituent data point.
   * @returns              The aggregate confidence level.
   */
  computeResultConfidence(inputStatuses) {
    if (inputStatuses.length === 0) {
      return "LOW";
    }
    let hasEstimated = false;
    let hasStaleOrUnavailable = false;
    for (const status of inputStatuses) {
      if (status === "ESTIMATED") {
        hasEstimated = true;
      } else if (status === "STALE" || status === "UNAVAILABLE") {
        hasStaleOrUnavailable = true;
      }
    }
    if (hasStaleOrUnavailable) {
      return "LOW";
    }
    if (hasEstimated) {
      return "MEDIUM";
    }
    return "HIGH";
  }
  // ---------------------------------------------------------------------------
  // Domain-specific: landed cost
  // ---------------------------------------------------------------------------
  /**
   * Compute aggregate confidence for the landed-cost calculator.
   *
   * Domain-specific variant of {@link computeResultConfidence} that operates
   * on the five named inputs the calculator materialises:
   * `productPrice`, `transport`, `excise`, `containerDuty`, `classification`.
   *
   * Rules:
   * - **HIGH**   — all five inputs are VERIFIED.
   * - **MEDIUM** — one or more inputs are ESTIMATED; none are STALE or
   *                UNAVAILABLE.
   * - **LOW**    — any input is STALE or UNAVAILABLE.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       The aggregate confidence level.
   */
  computeLandingCostConfidence(inputs) {
    return this.computeResultConfidence([
      inputs.productPrice,
      inputs.transport,
      inputs.excise,
      inputs.containerDuty,
      inputs.classification
    ]);
  }
  // ---------------------------------------------------------------------------
  // Evidence report from a status map
  // ---------------------------------------------------------------------------
  /**
   * Generate a confidence report from a labelled map of reliability statuses.
   *
   * Each entry in the map becomes a {@link ConfidenceDetail} in the
   * breakdown, labelled by its key.  The overall confidence is computed
   * from all values.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Record mapping data-point labels to reliability statuses.
   * @returns       A {@link ConfidenceReport} with aggregate and breakdown.
   */
  computeEvidenceFromStatuses(inputs) {
    const labels = Object.keys(inputs);
    const values = Object.values(inputs);
    const breakdown = labels.map((label) => ({
      status: inputs[label],
      detail: `[${label}] ${STATUS_DETAIL[inputs[label]]}`
    }));
    return {
      overall: this.computeResultConfidence(values),
      breakdown
    };
  }
  // ---------------------------------------------------------------------------
  // Delegate to ReliabilityService
  // ---------------------------------------------------------------------------
  /**
   * Compose multiple reliability statuses into a single result.
   *
   * Delegates to {@link ReliabilityService.composeReliability}.
   *
   * @param statuses  Non-empty array of statuses to compose.
   * @returns         The strictest (most conservative) status.
   */
  composeStatuses(statuses) {
    return this.reliabilityService.composeReliability(statuses);
  }
  // ---------------------------------------------------------------------------
  // Single-status mapping
  // ---------------------------------------------------------------------------
  /**
   * Map a single reliability status to its corresponding confidence level.
   *
   * - `VERIFIED`     → `HIGH`
   * - `ESTIMATED`    → `MEDIUM`
   * - `STALE`        → `LOW`
   * - `UNAVAILABLE`  → `LOW`
   *
   * @param status  The reliability status to map.
   * @returns       The corresponding confidence level.
   */
  confidenceFromStatus(status) {
    switch (status) {
      case "VERIFIED":
        return "HIGH";
      case "ESTIMATED":
        return "MEDIUM";
      case "STALE":
      case "UNAVAILABLE":
        return "LOW";
    }
  }
  // ---------------------------------------------------------------------------
  // Full report
  // ---------------------------------------------------------------------------
  /**
   * Produce a full confidence report — aggregate level plus per-status
   * breakdown with explanations.
   *
   * @param statuses  Reliability statuses for each constituent data point,
   *                  paired with a label identifying the data point.
   * @returns         A {@link ConfidenceReport} with aggregate and breakdown.
   */
  buildReport(statuses) {
    const rawStatuses = statuses.map((s) => s.status);
    const overall = this.computeResultConfidence(rawStatuses);
    const breakdown = statuses.map(({ status, label }) => ({
      status,
      detail: `[${label}] ${STATUS_DETAIL[status]}`
    }));
    return { overall, breakdown };
  }
  // ---------------------------------------------------------------------------
  // Named input detail
  // ---------------------------------------------------------------------------
  /**
   * Human-readable detail line for a named input and its reliability status.
   *
   * Produces context-aware messages that go beyond the generic
   * {@link STATUS_DETAIL} by incorporating the input name and status-specific
   * nuance (e.g. staleness thresholds).
   *
   * Pure function — no I/O, no side effects.
   *
   * @example
   * ```ts
   * formatConfidenceDetail("Price", "VERIFIED")
   * // => "Price data is verified and current"
   *
   * formatConfidenceDetail("Transport", "STALE")
   * // => "Transport estimate is stale (last refreshed over 7 days ago)"
   *
   * formatConfidenceDetail("Tax rates", "ESTIMATED")
   * // => "Tax rules include estimated rates (deposit status unknown)"
   * ```
   *
   * @param name    Human-readable input name (e.g. "Price", "Transport").
   * @param status  Reliability status of the input.
   * @returns       Human-readable detail string.
   */
  formatConfidenceDetail(name, status) {
    switch (status) {
      case "VERIFIED":
        return `${name} data is verified and current`;
      case "ESTIMATED": {
        if (name === "Price") {
          return `${name} data is estimated from category averages or similar products`;
        }
        if (name === "Transport") {
          return `${name} rates are estimated from weight and destination rules`;
        }
        if (name === "Tax rates" || name === "Excise duty") {
          return "Tax rules include estimated rates (deposit status unknown)";
        }
        return `${name} rules include estimated rates (deposit status unknown)`;
      }
      case "STALE": {
        if (name === "Price") {
          return `${name} data is stale (last refreshed over 24 hours ago)`;
        }
        if (name === "Transport") {
          return `${name} estimate is stale (last refreshed over 7 days ago)`;
        }
        if (name === "Classification") {
          return `${name} rules are stale (last reviewed over 30 days ago)`;
        }
        return `${name} data is stale (exceeded freshness threshold)`;
      }
      case "UNAVAILABLE":
        return `${name} data is not available for this product`;
    }
  }
  // ---------------------------------------------------------------------------
  // Full landed-cost detail report
  // ---------------------------------------------------------------------------
  /**
   * Generate a complete named-detail {@link ConfidenceReport} for the
   * landed-cost calculator inputs.
   *
   * Unlike {@link computeLandingCostConfidence} (which only returns the
   * aggregate level), this method populates the full breakdown with
   * per-input names and context-aware detail strings via
   * {@link formatConfidenceDetail}.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       A {@link ConfidenceReport} with aggregate level and
   *                per-input breakdown including `inputName`.
   */
  computeLandingCostDetail(inputs) {
    const entries = [
      { status: inputs.productPrice, name: "Price" },
      { status: inputs.transport, name: "Transport" },
      { status: inputs.excise, name: "Excise duty" },
      { status: inputs.containerDuty, name: "Container duty" },
      { status: inputs.classification, name: "Classification" }
    ];
    const breakdown = entries.map(({ status, name }) => ({
      inputName: name,
      status,
      detail: this.formatConfidenceDetail(name, status)
    }));
    return {
      overall: this.computeResultConfidence(entries.map((e) => e.status)),
      breakdown
    };
  }
  // ---------------------------------------------------------------------------
  // UI-friendly confidence snapshot
  // ---------------------------------------------------------------------------
  /**
   * Produce a UI-queryable confidence snapshot from the landed-cost inputs.
   *
   * The returned shape is designed for direct rendering — no further
   * transformation needed on the client side.
   *
   * - `overall` — the aggregate confidence level as an uppercase string.
   * - `explanation` — a human-readable paragraph summarising why the
   *   confidence is what it is.
   * - `inputs` — per-input statuses with names, status strings, and
   *   human-readable detail.
   *
   * Pure function — no I/O, no side effects.
   *
   * @param inputs  Reliability status for each landed-cost input.
   * @returns       A UI-ready confidence snapshot.
   */
  getConfidenceForUI(inputs) {
    const report = this.computeLandingCostDetail(inputs);
    const lowCount = report.breakdown.filter(
      (d) => d.status === "STALE" || d.status === "UNAVAILABLE"
    ).length;
    const estimatedCount = report.breakdown.filter(
      (d) => d.status === "ESTIMATED"
    ).length;
    const verifiedCount = report.breakdown.filter(
      (d) => d.status === "VERIFIED"
    ).length;
    let explanation;
    switch (report.overall) {
      case "HIGH":
        explanation = `All data points are verified against authoritative sources. The landed-cost calculation reflects current, reliable data.`;
        break;
      case "MEDIUM":
        explanation = `${estimatedCount} of 5 inputs are estimated from incomplete data: `;
        explanation += report.breakdown.filter((d) => d.status === "ESTIMATED").map((d) => d.inputName ?? "an input").join(", ");
        explanation += `. The result is reliable but may have minor inaccuracies.`;
        break;
      case "LOW":
        explanation = `${lowCount} of 5 inputs are stale or unavailable`;
        if (estimatedCount > 0) {
          explanation += ` and ${estimatedCount} are estimated`;
        }
        explanation += `. The result should be treated with caution`;
        if (verifiedCount > 0) {
          explanation += ` \u2014 ${verifiedCount} of 5 inputs are still current`;
        }
        explanation += `.`;
        break;
    }
    return {
      overall: report.overall,
      explanation,
      inputs: report.breakdown.map((d) => ({
        name: d.inputName ?? d.status,
        status: d.status,
        detail: d.detail
      }))
    };
  }
};
__name(ConfidenceFrameworkService, "ConfidenceFrameworkService");
ConfidenceFrameworkService = __decorateClass([
  Injectable()
], ConfidenceFrameworkService);

// ../../packages/core-domain/src/history/price-observation-recorder.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/calculator/calculator.types.ts
init_modules_watch_stub();
function hasValidEurConversion(offer) {
  if (offer.currency !== void 0 && offer.currency.trim().toUpperCase() !== "EUR") {
    return false;
  }
  const original = offer.originalCurrency?.trim().toUpperCase();
  if (original !== void 0 && original !== "EUR") {
    const version = offer.fxDatasetVersion?.trim();
    if (version === void 0 || version === "") return false;
  }
  return true;
}
__name(hasValidEurConversion, "hasValidEurConversion");
var PRODUCT_DATA_PORT = "PRODUCT_DATA_PORT";
var CALCULATION_RECORD_PORT = "CALCULATION_RECORD_PORT";
var ClassificationGateRejectionError = class extends Error {
  static {
    __name(this, "ClassificationGateRejectionError");
  }
  productId;
  reason;
  constructor(productId, reason) {
    super(`Product ${productId} rejected by classification gate: ${reason}`);
    this.name = "ClassificationGateRejectionError";
    this.productId = productId;
    this.reason = reason;
  }
};
var ProductNotFoundError = class extends Error {
  static {
    __name(this, "ProductNotFoundError");
  }
  productId;
  constructor(productId) {
    super(`Product ${productId} not found in product master`);
    this.name = "ProductNotFoundError";
    this.productId = productId;
  }
};
var NoRetailOffersError = class extends Error {
  static {
    __name(this, "NoRetailOffersError");
  }
  productId;
  constructor(productId) {
    super(`No retail offers found for product ${productId}`);
    this.name = "NoRetailOffersError";
    this.productId = productId;
  }
};

// ../../packages/core-domain/src/history/price-observation.port.ts
init_modules_watch_stub();
var PRICE_OBSERVATION_PORT = "PRICE_OBSERVATION_PORT";

// ../../packages/core-domain/src/history/price-observation-recorder.service.ts
var OBSERVATION_DESTINATION = "FI";
var BASELINE_QUANTITY = 1;
var PriceObservationRecorderService = class {
  constructor(classificationGate, alcoholExcise, containerDuty, transportEstimation, confidenceFramework, productData, observations) {
    this.classificationGate = classificationGate;
    this.alcoholExcise = alcoholExcise;
    this.containerDuty = containerDuty;
    this.transportEstimation = transportEstimation;
    this.confidenceFramework = confidenceFramework;
    this.productData = productData;
    this.observations = observations;
  }
  classificationGate;
  alcoholExcise;
  containerDuty;
  transportEstimation;
  confidenceFramework;
  productData;
  observations;
  logger = new Logger(PriceObservationRecorderService.name);
  /**
   * Record one observation for a changed merchant offer and append it to
   * the observation log.
   *
   * Mirrors the calculator's steps for identical inputs at quantity=1:
   * gate → product → transport → tax engines (asOf = observedAt) →
   * confidence → cost assembly — then appends instead of persisting a
   * session-scoped calculation record.
   *
   * @throws {ProductNotFoundError}           If the product master lacks the product.
   * @throws {ClassificationGateRejectionError} If the product is unclassified —
   *   an observation must never record a baseline the calculator would refuse.
   */
  async record(input) {
    const { offer, observedAt } = input;
    const product = await this.productData.findProductById(input.productId);
    if (product === null) {
      throw new ProductNotFoundError(input.productId);
    }
    const gateResult = this.classificationGate.checkProductGate({
      regulatoryClassification: product.regulatoryClassification
    });
    if (!gateResult.passed) {
      throw new ClassificationGateRejectionError(
        input.productId,
        gateResult.reason
      );
    }
    const transport = await this.selectTransportOffer(product, offer);
    const exciseResult = await this.alcoholExcise.calculate(
      product.category.toLowerCase(),
      product.alcoholByVolume,
      product.volumeLitres,
      observedAt
    );
    const containerDutyResult = await this.containerDuty.calculate(
      product.volumeLitres,
      product.containerType,
      product.depositSystemStatus,
      observedAt
    );
    const inputReliability = {
      retailPrice: resolveRetailOfferStatus(offer.reliabilityStatus),
      transport: transport.status,
      exciseRule: exciseResult.reliability,
      containerDutyRule: containerDutyResult.reliability
    };
    const confidenceReport = this.confidenceFramework.buildReport([
      { status: inputReliability.retailPrice, label: "productPrice" },
      { status: inputReliability.transport, label: "transport" },
      { status: inputReliability.exciseRule, label: "excise" },
      { status: inputReliability.containerDutyRule, label: "containerDuty" }
    ]);
    const landedCostCents = offer.priceCents * BASELINE_QUANTITY + exciseResult.taxCents * BASELINE_QUANTITY + containerDutyResult.dutyCents * BASELINE_QUANTITY + transport.costCents;
    const observation = {
      productId: product.id,
      merchant: offer.merchant,
      retailOfferId: offer.id,
      observedAt,
      foreignRetailPriceCents: offer.priceCents,
      transportOfferId: transport.offerId,
      transportCostCents: transport.costCents,
      exciseRuleVersion: toRuleVersionSnapshot(
        exciseResult.ruleId,
        exciseResult.taxDatasetVersion
      ),
      containerDutyRuleVersion: toRuleVersionSnapshot(
        containerDutyResult.ruleId,
        containerDutyResult.taxDatasetVersion
      ),
      landedCostCents,
      inputReliability,
      confidence: confidenceReport.overall
    };
    const { id } = await this.observations.append(observation);
    this.logger.log(
      `Recorded observation ${id}: offer ${offer.id} (merchant ${offer.merchant}) at ${observedAt.toISOString()}, landed cost ${landedCostCents} cents, confidence ${confidenceReport.overall}`
    );
    return { ...observation, id };
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /**
   * Select the current transport offer for the observation's baseline
   * route. Degrades gracefully exactly like the calculator: when no offer
   * matches, the transport input is UNAVAILABLE at zero cost instead of an
   * error.
   */
  async selectTransportOffer(product, offer) {
    try {
      const estimate = await this.transportEstimation.estimate(
        offer.merchant,
        offer.country,
        OBSERVATION_DESTINATION,
        product.weightKg,
        product.containerType
      );
      return {
        offerId: estimate.offer.id,
        costCents: estimate.offer.priceCents,
        status: estimate.reliabilityStatus
      };
    } catch {
      return { offerId: null, costCents: 0, status: "UNAVAILABLE" };
    }
  }
};
__name(PriceObservationRecorderService, "PriceObservationRecorderService");
PriceObservationRecorderService = __decorateClass([
  Injectable(),
  __decorateParam(5, Inject(PRODUCT_DATA_PORT)),
  __decorateParam(6, Inject(PRICE_OBSERVATION_PORT))
], PriceObservationRecorderService);
function toRuleVersionSnapshot(ruleId, versionLabel) {
  return ruleId === null ? null : { ruleId, versionLabel };
}
__name(toRuleVersionSnapshot, "toRuleVersionSnapshot");
function resolveRetailOfferStatus(status) {
  const raw2 = status?.toUpperCase() ?? "ESTIMATED";
  if (raw2 === "VERIFIED") return "VERIFIED";
  if (raw2 === "STALE") return "STALE";
  if (raw2 === "UNAVAILABLE") return "UNAVAILABLE";
  return "ESTIMATED";
}
__name(resolveRetailOfferStatus, "resolveRetailOfferStatus");

// ../../packages/core-domain/src/calculator/landed-cost-calculator.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/disclaimer.ts
init_modules_watch_stub();
var DISCLAIMER_FI = {
  text: "Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden m\xE4\xE4r\xE4. Lopullinen verovelvollisuus m\xE4\xE4r\xE4ytyy Tullin ja Verohallinnon vahvistamien verokantojen ja s\xE4\xE4nn\xF6sten mukaan.",
  language: "fi",
  version: "1.0"
};

// ../../packages/core-domain/src/calculator/landed-cost-calculator.service.ts
var LandedCostCalculatorService = class {
  constructor(classificationGate, alcoholExcise, containerDuty, transactionClassification, transportEstimation, confidenceFramework, productData, calculationRecords) {
    this.classificationGate = classificationGate;
    this.alcoholExcise = alcoholExcise;
    this.containerDuty = containerDuty;
    this.transactionClassification = transactionClassification;
    this.transportEstimation = transportEstimation;
    this.confidenceFramework = confidenceFramework;
    this.productData = productData;
    this.calculationRecords = calculationRecords;
  }
  classificationGate;
  alcoholExcise;
  containerDuty;
  transactionClassification;
  transportEstimation;
  confidenceFramework;
  productData;
  calculationRecords;
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  /**
   * Calculate the full landed cost for a single product.
   *
   * Steps:
   * 1. Check the classification gate — unclassified products are rejected.
   * 2. Resolve product master data and retail offers.
   * 3. Estimate transport cost.
   * 4. Calculate alcohol excise and container duty.
   * 5. Classify the transaction.
   * 6. Compute overall confidence.
   * 7. Assemble and persist the itemized result.
   */
  async calculate(input) {
    const product = await this.resolveProduct(input);
    const gateResult = this.classificationGate.checkProductGate({
      regulatoryClassification: product.regulatoryClassification
    });
    if (!gateResult.passed) {
      throw new ClassificationGateRejectionError(
        input.productId,
        gateResult.reason
      );
    }
    const offers = await this.productData.findRetailOffers(input.productId);
    if (offers.length === 0) {
      throw new NoRetailOffersError(input.productId);
    }
    const { usable, exclusions } = this.partitionOffersByConversion(offers);
    if (usable.length === 0) {
      throw new NoRetailOffersError(input.productId);
    }
    const bestOffer = this.selectBestOffer(usable);
    const transportResult = await this.estimateTransport(
      input,
      product,
      bestOffer
    );
    let transportCostCents = 0;
    let transportOfferId = null;
    let transportStatus = "UNAVAILABLE";
    if (transportResult !== null) {
      transportCostCents = transportResult.offer.priceCents;
      transportOfferId = transportResult.offer.id;
      transportStatus = transportResult.reliabilityStatus;
    }
    const transportCtx = transportResult !== null ? {
      transportStatus,
      sellerInvolvementIndicator: transportResult.offer.sellerInvolvementIndicator,
      carrierId: input.transportMethod ?? bestOffer.merchant
    } : null;
    const computed = await this.computeItemCosts(
      input,
      product,
      bestOffer,
      transportCtx
    );
    const transportItem = {
      label: "Transport",
      category: "transportCost",
      cents: transportCostCents,
      reliability: transportStatus
    };
    const allItemizedCosts = [
      computed.itemizedCosts[0],
      // Retail price
      transportItem,
      ...computed.itemizedCosts.slice(1)
      // Excise, Container duty
    ];
    const totalCents = computed.retailTotal + transportCostCents + computed.exciseTotal + computed.containerDutyTotal;
    const originalRetailPrice = bestOffer.originalCurrency !== void 0 && bestOffer.originalPriceCents !== void 0 ? {
      priceCents: bestOffer.originalPriceCents,
      currency: bestOffer.originalCurrency
    } : void 0;
    const persisted = await this.calculationRecords.create({
      productMasterId: product.id,
      retailOfferIds: [bestOffer.id],
      transportOfferId,
      exciseRuleVersionId: computed.exciseRuleVersionId,
      containerDutyRuleVersionId: computed.containerDutyRuleVersionId,
      totalCents,
      breakdown: allItemizedCosts,
      confidence: computed.confidenceOverall,
      quantity: input.quantity,
      destination: input.destination,
      disclaimer: DISCLAIMER_FI,
      sessionId: input.sessionId ?? null
    });
    return {
      itemizedCosts: allItemizedCosts,
      excludedOffers: exclusions,
      ...originalRetailPrice !== void 0 ? { originalRetailPrice } : {},
      foreignRetailPrice: computed.retailTotal,
      transportCost: transportCostCents,
      alcoholExciseEstimate: computed.exciseTotal,
      containerDutyEstimate: computed.containerDutyTotal,
      totalCents,
      currency: "EUR",
      confidence: computed.confidenceOverall,
      confidenceBreakdown: computed.confidenceBreakdown,
      disclaimer: DISCLAIMER_FI,
      classification: computed.classificationResult,
      metadata: {
        input,
        calculationTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
        productMasterId: product.id,
        retailOfferIds: [bestOffer.id],
        quantity: input.quantity,
        destination: input.destination,
        productName: product.normalizedName,
        volumeLitres: product.volumeLitres,
        alcoholByVolume: product.alcoholByVolume,
        category: product.category,
        datasetVersions: computed.datasetVersions,
        transportOfferId
      },
      calculationRecordId: persisted.id
    };
  }
  // ---------------------------------------------------------------------------
  // Shared offer-constrained computation
  // ---------------------------------------------------------------------------
  /**
   * Compute item-level costs (retail, excise, container duty, classification,
   * confidence) for a given product + retail-offer pair.
   *
   * WHY transport is a parameter, not computed here:
   *   - The single-item calculator resolves transport via
   *     TransportEstimationService (see #estimateTransport).
   *   - The basket optimizer computes per-store consolidated shipping via
   *     BasketShippingCalculator, which may differ from per-item transport.
   *   - Passing transport context as a parameter lets BOTH paths share every
   *     other engine step (tax, classification, confidence), guaranteeing
   *     T2.8 consistency without constraining transport strategy.
   *
   * @param input       Calculator input (destination, quantity, transport
   *                    arrangement).
   * @param product     Resolved product master data.
   * @param offer       The retail offer to compute costs for.
   * @param transportCtx  Transport context for classification and confidence.
   *                    Pass null when transport is unavailable (confidence
   *                    degrades gracefully).
   */
  async computeItemCosts(input, product, offer, transportCtx) {
    const exciseCategory = product.category.toLowerCase();
    const exciseResult = await this.alcoholExcise.calculate(
      exciseCategory,
      product.alcoholByVolume,
      product.volumeLitres
    );
    const containerDutyResult = await this.containerDuty.calculate(
      product.volumeLitres,
      product.containerType,
      product.depositSystemStatus
    );
    const sellerInvolvementIndicator = transportCtx?.sellerInvolvementIndicator ?? false;
    const carrierId = transportCtx?.carrierId ?? offer.merchant;
    const transportArrangement = input.transportArrangement ?? "SELLER_ARRANGED";
    const classificationInput = {
      sellerInvolvementIndicator,
      carrierId,
      sellerCountry: offer.country,
      buyerCountry: input.destination,
      buyerIsTravelling: transportArrangement === "PERSONAL",
      sellerId: offer.merchant
    };
    const classificationResult = await this.transactionClassification.classify(classificationInput);
    const retailStatus = this.resolveRetailOfferStatus(offer);
    const exciseStatus = exciseResult.reliability;
    const containerDutyStatus = containerDutyResult.reliability;
    const classificationStatus = classificationResult.confidence === "HIGH" ? "VERIFIED" : "ESTIMATED";
    const transportStatus = transportCtx?.transportStatus ?? "UNAVAILABLE";
    const confidenceReport = this.confidenceFramework.buildReport([
      { status: retailStatus, label: "productPrice" },
      { status: transportStatus, label: "transport" },
      { status: exciseStatus, label: "excise" },
      { status: containerDutyStatus, label: "containerDuty" },
      { status: classificationStatus, label: "classification" }
    ]);
    const retailTotal = offer.priceCents * input.quantity;
    const exciseTotal = exciseResult.taxCents * input.quantity;
    const containerDutyTotal = containerDutyResult.dutyCents * input.quantity;
    const datasetVersions = [];
    if (exciseResult.taxDatasetVersion)
      datasetVersions.push(exciseResult.taxDatasetVersion);
    if (containerDutyResult.taxDatasetVersion)
      datasetVersions.push(containerDutyResult.taxDatasetVersion);
    if (offer.fxDatasetVersion) datasetVersions.push(offer.fxDatasetVersion);
    const itemizedCosts = [
      {
        label: "Retail price",
        category: "foreignRetailPrice",
        cents: retailTotal,
        reliability: retailStatus,
        breakdown: [
          {
            label: `Unit price (x${input.quantity})`,
            category: "foreignRetailPrice",
            cents: retailTotal,
            reliability: retailStatus
          }
        ]
      },
      {
        label: "Alcohol excise",
        category: "alcoholExciseEstimate",
        cents: exciseTotal,
        reliability: exciseStatus
      },
      {
        label: "Container duty",
        category: "containerDutyEstimate",
        cents: containerDutyTotal,
        reliability: containerDutyStatus
      }
    ];
    return {
      retailTotal,
      retailStatus,
      exciseTotal,
      exciseStatus,
      exciseRuleVersionId: exciseResult.ruleId,
      containerDutyTotal,
      containerDutyStatus,
      containerDutyRuleVersionId: containerDutyResult.ruleId,
      classificationResult,
      classificationStatus,
      confidenceOverall: confidenceReport.overall,
      confidenceBreakdown: confidenceReport.breakdown,
      datasetVersions,
      itemizedCosts
    };
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /**
   * Resolve product master data. Returns the CalculatorProductData needed
   * by downstream steps.
   */
  async resolveProduct(input) {
    const product = await this.productData.findProductById(input.productId);
    if (product === null) {
      throw new ProductNotFoundError(input.productId);
    }
    return product;
  }
  /**
   * Split offers into summable (validly-converted EUR) and excluded with
   * a visible per-offer reason (task 1.5, spec: landed-cost-calculator
   * "Single-currency totals"). Excluded offers keep their original
   * amount/currency on the exclusion entry for display.
   */
  partitionOffersByConversion(offers) {
    const usable = [];
    const exclusions = [];
    for (const offer of offers) {
      if (hasValidEurConversion(offer)) {
        usable.push(offer);
        continue;
      }
      exclusions.push({
        offerId: offer.id,
        merchant: offer.merchant,
        country: offer.country,
        reason: "NO_VALID_EUR_CONVERSION",
        detail: `Offer ${offer.id} (${offer.merchant}) lacks a valid EUR conversion \u2014 canonical currency ${offer.currency ?? "EUR (assumed)"}, original ${offer.originalCurrency ?? "n/a"}` + (offer.fxDatasetVersion ? `, FX dataset version ${offer.fxDatasetVersion}` : ", no recorded FX conversion"),
        originalPriceCents: offer.originalPriceCents ?? null,
        originalCurrency: offer.originalCurrency ?? null
      });
    }
    return { usable, exclusions };
  }
  /**
   * Select the best retail offer — lowest price wins.
   * This may be enriched with additional scoring in the future.
   */
  selectBestOffer(offers) {
    let best = offers[0];
    for (let i = 1; i < offers.length; i++) {
      if (offers[i].priceCents < best.priceCents) {
        best = offers[i];
      }
    }
    return best;
  }
  /**
   * Estimate transport cost for this product.
   * Returns null when no transport offers are found (graceful degradation).
   */
  async estimateTransport(input, product, offer) {
    const carrier = input.transportMethod ?? offer.merchant;
    const origin = offer.country;
    try {
      const estimate = await this.transportEstimation.estimate(
        carrier,
        origin,
        input.destination,
        product.weightKg,
        product.containerType
      );
      return {
        offer: {
          id: estimate.offer.id,
          priceCents: estimate.offer.priceCents,
          sellerInvolvementIndicator: estimate.offer.sellerInvolvementIndicator
        },
        reliabilityStatus: estimate.reliabilityStatus
      };
    } catch {
      return null;
    }
  }
  /**
   * Map the retail offer's reliability status string to a canonical
   * ReliabilityStatus.
   */
  resolveRetailOfferStatus(offer) {
    const raw2 = offer.reliabilityStatus?.toUpperCase() ?? "ESTIMATED";
    if (raw2 === "VERIFIED") return "VERIFIED";
    if (raw2 === "STALE") return "STALE";
    if (raw2 === "UNAVAILABLE") return "UNAVAILABLE";
    return "ESTIMATED";
  }
};
__name(LandedCostCalculatorService, "LandedCostCalculatorService");
LandedCostCalculatorService = __decorateClass([
  Injectable(),
  __decorateParam(6, Inject(PRODUCT_DATA_PORT)),
  __decorateParam(7, Inject(CALCULATION_RECORD_PORT))
], LandedCostCalculatorService);

// ../../packages/core-domain/src/classification/transaction-classification.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/classification/services/classification-rule-engine.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/classification/ports/classification-rule-repository.port.ts
init_modules_watch_stub();
var CLASSIFICATION_RULE_REPOSITORY_PORT = "CLASSIFICATION_RULE_REPOSITORY_PORT";

// ../../packages/core-domain/src/classification/evidence.utils.ts
init_modules_watch_stub();
function buildEvidenceSummary(evidence) {
  if (!evidence || evidence.length === 0) {
    return "No supporting evidence recorded.";
  }
  if (evidence.length === 1) {
    const e = evidence[0];
    return `Based on: ${e.observation} (${e.supportingData})`;
  }
  const bullets = evidence.map(
    (e) => `- Based on: ${e.observation} (${e.supportingData})`
  );
  return `Classification based on the following evidence:
${bullets.join("\n")}`;
}
__name(buildEvidenceSummary, "buildEvidenceSummary");

// ../../packages/core-domain/src/classification/services/classification-rule-engine.service.ts
function createDefaultRuleSet() {
  const rules = [
    {
      name: "TravellerImport",
      version: "1.0",
      description: "Buyer physically carries goods across the border. Excluded from landed-cost calculation; duty-free allowances apply (Alcohol Act 1102/2017, chapter 5).",
      evaluate(input) {
        if (input.buyerIsTravelling) {
          const evidence = [
            {
              observation: "Buyer indicated they are physically carrying goods across the border",
              supportingData: `destination: ${input.sellerCountry}, buyer country: ${input.buyerCountry}`,
              source: "buyerIsTravelling"
            },
            {
              observation: "Personal import allowance applies \u2014 excluded from landed-cost calculator",
              supportingData: "transport arrangement: personal transport",
              source: "buyerIsTravelling"
            }
          ];
          return {
            classification: "TravellerImport",
            confidence: "HIGH",
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence)
          };
        }
        return null;
      }
    },
    {
      name: "DistanceSelling",
      version: "1.0",
      description: "Seller arranges transport to Finland and is liable for Finnish excise duties (EU distance-selling rules, Alcohol Act 1102/2017 section 43).",
      evaluate(input) {
        if (input.sellerInvolvementIndicator) {
          const carrierLabel = input.carrierId && input.carrierId.trim().length > 0 ? `carrier: ${input.carrierId}` : "carrier information not available";
          const evidence = [
            {
              observation: "Retailer offers direct delivery to buyer's country",
              supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}, ${carrierLabel}`,
              source: "sellerInvolvementIndicator"
            }
          ];
          return {
            classification: "DistanceSelling",
            confidence: "HIGH",
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence)
          };
        }
        return null;
      }
    },
    {
      name: "DistanceBuyingKnownCarrier",
      version: "1.0",
      description: "Buyer arranges independent transport via an identified carrier. Buyer is liable for excise duties upon import (Tax Administration guidance VH/5088/00.01.00/2021).",
      evaluate(input) {
        if (!input.sellerInvolvementIndicator && input.carrierId && input.carrierId.trim().length > 0) {
          const confidence = input.sellerId && input.sellerId.trim().length > 0 ? "HIGH" : "MEDIUM";
          const evidence = [
            {
              observation: "Buyer arranged transport via independent carrier",
              supportingData: `carrier: ${input.carrierId}`,
              source: "carrierId"
            },
            {
              observation: "Seller did not arrange transport",
              supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}`,
              source: "sellerInvolvementIndicator"
            }
          ];
          if (confidence === "HIGH") {
            evidence.push({
              observation: "Seller identity confirmed",
              supportingData: `seller: ${input.sellerId}`,
              source: "sellerId"
            });
          } else {
            evidence.push({
              observation: "Seller identity is unverified, reducing confidence",
              supportingData: "no seller identifier provided",
              source: "sellerId"
            });
          }
          return {
            classification: "DistanceBuying",
            confidence,
            evidence,
            evidenceSummary: buildEvidenceSummary(evidence)
          };
        }
        return null;
      }
    },
    {
      name: "DistanceBuyingUnknownTransport",
      version: "1.0",
      description: "Transport arrangement could not be determined. Defaults to distance buying with LOW confidence \u2014 buyer should verify their duty liability.",
      evaluate(input) {
        const evidence = [
          {
            observation: "Transport arrangement could not be determined",
            supportingData: `seller country: ${input.sellerCountry}, buyer country: ${input.buyerCountry}, no carrier identified, seller not involved in shipping`,
            source: "TransportClassification"
          }
        ];
        return {
          classification: "DistanceBuying",
          confidence: "LOW",
          evidence,
          evidenceSummary: buildEvidenceSummary(evidence)
        };
      }
    }
  ];
  return {
    rules,
    version: "1.0",
    label: "Current Finnish legislation \u2014 pre-Sep 2024",
    effectiveFrom: /* @__PURE__ */ new Date("2024-01-01"),
    effectiveTo: null
  };
}
__name(createDefaultRuleSet, "createDefaultRuleSet");
var ClassificationRuleEngine = class {
  constructor(repository) {
    this.repository = repository;
  }
  repository;
  logger = new Logger(ClassificationRuleEngine.name);
  /** Built-in default rule set — used when no repository is wired. */
  defaultRuleSet = createDefaultRuleSet();
  /**
   * Classify a transaction using the rule set effective on the given date.
   *
   * When a repository is wired, the engine loads the rule set for the given
   * date from the database.  Otherwise it falls back to the built-in default.
   *
   * @param input — The transaction details.
   * @param asOf  — The effective date for rule selection (defaults to now).
   * @returns     The classification result plus the rule set metadata.
   */
  async classify(input, asOf) {
    const effectiveDate = asOf ?? /* @__PURE__ */ new Date();
    let ruleSet;
    if (this.repository) {
      const record = await this.repository.findEffective(effectiveDate);
      if (record) {
        ruleSet = this.mapToRuleSet(record);
      } else {
        this.logger.warn(
          `No rule set found effective ${effectiveDate.toISOString()}, falling back to default.`
        );
        ruleSet = this.defaultRuleSet;
      }
    } else {
      ruleSet = this.defaultRuleSet;
    }
    for (const rule of ruleSet.rules) {
      const result = rule.evaluate(input);
      if (result !== null) {
        return {
          result,
          ruleSet: {
            version: ruleSet.version,
            label: ruleSet.label,
            effectiveFrom: ruleSet.effectiveFrom,
            effectiveTo: ruleSet.effectiveTo
          },
          ruleName: rule.name
        };
      }
    }
    throw new Error(
      `No classification rule matched input for effective date ${effectiveDate.toISOString()}`
    );
  }
  /**
   * Synchronous classify for use when async is not needed (e.g. in-memory).
   *
   * Uses the default rule set only.  Throws if no rule matches.
   */
  classifySync(input) {
    const ruleSet = this.defaultRuleSet;
    for (const rule of ruleSet.rules) {
      const result = rule.evaluate(input);
      if (result !== null) {
        return {
          result,
          ruleSet: {
            version: ruleSet.version,
            label: ruleSet.label,
            effectiveFrom: ruleSet.effectiveFrom,
            effectiveTo: ruleSet.effectiveTo
          },
          ruleName: rule.name
        };
      }
    }
    throw new Error("No classification rule matched the given input");
  }
  /**
   * Map a repository record (descriptors) to a full rule set with evaluation
   * functions.
   *
   * The mapping is done by name lookup against the built-in rule registry.
   * This keeps the database schema lean — rules are stored as a JSON array
   * of { name, version, description } triples, and the actual evaluation
   * logic lives in TypeScript.
   */
  mapToRuleSet(record) {
    const allRules = this.defaultRuleSet.rules;
    const registry = /* @__PURE__ */ new Map();
    for (const rule of allRules) {
      registry.set(rule.name, rule);
    }
    const resolved = [];
    for (const descriptor of record.rules) {
      const rule = registry.get(descriptor.name);
      if (rule) {
        resolved.push({ ...rule, version: descriptor.version });
      } else {
        this.logger.warn(
          `Rule "${descriptor.name}" (v${descriptor.version}) not found in registry \u2014 skipping.`
        );
      }
    }
    return {
      rules: resolved,
      version: record.versionLabel,
      label: record.label,
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo
    };
  }
};
__name(ClassificationRuleEngine, "ClassificationRuleEngine");
ClassificationRuleEngine = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(CLASSIFICATION_RULE_REPOSITORY_PORT))
], ClassificationRuleEngine);

// ../../packages/core-domain/src/classification/transaction-classification.service.ts
var TransactionClassificationService = class {
  constructor(transportClassification, ruleEngine) {
    this.transportClassification = transportClassification;
    this.ruleEngine = ruleEngine;
  }
  transportClassification;
  ruleEngine;
  /**
   * Classify a transaction under Finnish excise law.
   *
   * Delegates to the rule engine when available; otherwise uses built-in
   * hardcoded rules.
   *
   * @param params — All inputs required for classification.
   * @param asOf   — Effective date for rule selection (defaults to now).
   * @returns      A definitive {@link ClassificationResult} with evidence.
   */
  async classify(params, asOf) {
    if (this.ruleEngine) {
      const engineResult = await this.ruleEngine.classify(params, asOf);
      return engineResult.result;
    }
    return this.classifyInternal(params);
  }
  /**
   * Synchronous classification using built-in rules only.
   *
   * Useful when the caller cannot await (e.g., in tests or sync contexts).
   * Throws when no rule matches (should never happen with built-in rules).
   */
  classifySync(params) {
    if (this.ruleEngine) {
      const engineResult = this.ruleEngine.classifySync(params);
      return engineResult.result;
    }
    return this.classifyInternal(params);
  }
  /**
   * Internal classification logic — the 4-rule pipeline.
   *
   * Rules evaluated in priority order:
   * 1. Traveller Import — buyerIsTravelling is true
   * 2. Distance Selling — transport is RETAILER_ARRANGED
   * 3. Distance Buying (known carrier) — transport is INDEPENDENT_CARRIER
   * 4. Distance Buying (unknown) — transport is UNKNOWN
   */
  classifyInternal(params) {
    const transportType = this.transportClassification.classifyTransport(
      params.sellerInvolvementIndicator,
      params.carrierId
    );
    if (params.buyerIsTravelling) {
      const evidence2 = [
        {
          observation: "Buyer indicated they are physically carrying goods across the border",
          supportingData: `destination: ${params.sellerCountry}, buyer country: ${params.buyerCountry}`,
          source: "buyerIsTravelling"
        },
        {
          observation: "Personal import allowance applies \u2014 excluded from landed-cost calculator",
          supportingData: "transport arrangement: personal transport",
          source: "buyerIsTravelling"
        }
      ];
      return {
        classification: "TravellerImport",
        confidence: "HIGH",
        evidence: evidence2,
        evidenceSummary: buildEvidenceSummary(evidence2)
      };
    }
    if (transportType === "RETAILER_ARRANGED") {
      const carrierLabel = params.carrierId && params.carrierId.trim().length > 0 ? `carrier: ${params.carrierId}` : "carrier information not available";
      const evidence2 = [
        {
          observation: "Retailer offers direct delivery to buyer's country",
          supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}, ${carrierLabel}`,
          source: "sellerInvolvementIndicator"
        }
      ];
      return {
        classification: "DistanceSelling",
        confidence: "HIGH",
        evidence: evidence2,
        evidenceSummary: buildEvidenceSummary(evidence2)
      };
    }
    if (transportType === "INDEPENDENT_CARRIER") {
      const confidence = params.sellerId && params.sellerId.trim().length > 0 ? "HIGH" : "MEDIUM";
      const evidence2 = [
        {
          observation: "Buyer arranged transport via independent carrier",
          supportingData: `carrier: ${params.carrierId}`,
          source: "carrierId"
        },
        {
          observation: "Seller did not arrange transport",
          supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}`,
          source: "sellerInvolvementIndicator"
        }
      ];
      if (confidence === "HIGH") {
        evidence2.push({
          observation: "Seller identity confirmed",
          supportingData: `seller: ${params.sellerId}`,
          source: "sellerId"
        });
      } else {
        evidence2.push({
          observation: "Seller identity is unverified, reducing confidence",
          supportingData: "no seller identifier provided",
          source: "sellerId"
        });
      }
      return {
        classification: "DistanceBuying",
        confidence,
        evidence: evidence2,
        evidenceSummary: buildEvidenceSummary(evidence2)
      };
    }
    const evidence = [
      {
        observation: "Transport arrangement could not be determined",
        supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}, no carrier identified, seller not involved in shipping`,
        source: "TransportClassification"
      }
    ];
    return {
      classification: "DistanceBuying",
      confidence: "LOW",
      evidence,
      evidenceSummary: buildEvidenceSummary(evidence)
    };
  }
};
__name(TransactionClassificationService, "TransactionClassificationService");
TransactionClassificationService = __decorateClass([
  Injectable(),
  __decorateParam(1, Optional()),
  __decorateParam(1, Inject(ClassificationRuleEngine))
], TransactionClassificationService);

// ../../packages/core-domain/src/transport/transport-classification.service.ts
init_modules_watch_stub();
var TransportClassificationService = class {
  /**
   * Classify a transaction's transport arrangement.
   *
   * @param sellerInvolvementIndicator  `true` when the seller selected/paid
   *                                    the carrier (from TransportOffer).
   * @param carrierId                   Carrier identifier (e.g., 'posti',
   *                                    'dhl', 'schenker', or an empty string
   *                                    when unknown).
   */
  classifyTransport(sellerInvolvementIndicator, carrierId) {
    if (sellerInvolvementIndicator) {
      return "RETAILER_ARRANGED";
    }
    if (carrierId && carrierId.trim().length > 0) {
      return "INDEPENDENT_CARRIER";
    }
    return "UNKNOWN";
  }
};
__name(TransportClassificationService, "TransportClassificationService");
TransportClassificationService = __decorateClass([
  Injectable()
], TransportClassificationService);

// ../../packages/core-domain/src/reliability/merchant-reliability-score.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/reliability/merchant-reliability-score.types.ts
init_modules_watch_stub();
var MerchantReliabilityInputError = class extends Error {
  static {
    __name(this, "MerchantReliabilityInputError");
  }
  constructor(message) {
    super(message);
    this.name = "MerchantReliabilityInputError";
  }
};

// ../../packages/core-domain/src/reliability/merchant-reliability-score.service.ts
var MerchantReliabilityScoreService = class {
  constructor(reliabilityService) {
    this.reliabilityService = reliabilityService;
  }
  reliabilityService;
  /**
   * Compute a factual reliability score for one merchant.
   *
   * @param input  Per-merchant offer-status aggregate + governance status.
   * @returns      Counts, shares, strictest status, freshest observedAt,
   *               governance status, and the computation timestamp.
   * @throws {@link MerchantReliabilityInputError} when statusCounts holds
   *         an unknown status key, a negative or non-integer count, or the
   *         counts do not sum to offerCount.
   */
  computeScore(input) {
    const statusCounts = this.normalizeStatusCounts(input);
    const statusShares = {};
    for (const status of RELIABILITY_ORDER) {
      statusShares[status] = input.offerCount === 0 ? 0 : statusCounts[status] / input.offerCount;
    }
    const presentStatuses = RELIABILITY_ORDER.filter(
      (status) => statusCounts[status] > 0
    );
    return {
      merchant: input.merchant,
      offerCount: input.offerCount,
      statusCounts,
      statusShares,
      strictestStatus: this.reliabilityService.composeReliability(presentStatuses),
      freshestObservedAt: input.freshestObservedAt,
      governancePermissionStatus: input.governancePermissionStatus,
      computedAt: /* @__PURE__ */ new Date()
    };
  }
  /**
   * Validate raw counts and materialise a record with all four statuses
   * present (absent statuses default to 0) so the serialized shape is stable.
   */
  normalizeStatusCounts(input) {
    const raw2 = input.statusCounts ?? {};
    let sum = 0;
    const normalized = {};
    for (const status of RELIABILITY_ORDER) {
      const count = raw2[status] ?? 0;
      if (!Number.isInteger(count) || count < 0) {
        throw new MerchantReliabilityInputError(
          `Count for status "${status}" must be a non-negative integer, got ${count}`
        );
      }
      normalized[status] = count;
      sum += count;
    }
    for (const key of Object.keys(raw2)) {
      if (!RELIABILITY_ORDER.includes(key)) {
        throw new MerchantReliabilityInputError(
          `Unknown reliability status "${key}"; expected one of ${RELIABILITY_ORDER.join(", ")}`
        );
      }
    }
    if (sum !== input.offerCount) {
      throw new MerchantReliabilityInputError(
        `statusCounts sum (${sum}) does not match offerCount (${input.offerCount})`
      );
    }
    return normalized;
  }
};
__name(MerchantReliabilityScoreService, "MerchantReliabilityScoreService");
MerchantReliabilityScoreService = __decorateClass([
  Injectable()
], MerchantReliabilityScoreService);

// ../../packages/core-domain/src/optimizer/services/basket-optimizer.service.ts
init_modules_watch_stub();

// ../../packages/core-domain/src/optimizer/ports/merchant-terms.port.ts
init_modules_watch_stub();
var MERCHANT_TERMS_PORT = "MERCHANT_TERMS_PORT";

// ../../packages/core-domain/src/optimizer/ports/basket-calculation-record.port.ts
init_modules_watch_stub();
var BASKET_CALCULATION_RECORD_PORT = "BASKET_CALCULATION_RECORD_PORT";

// ../../packages/core-domain/src/optimizer/optimizer.types.ts
init_modules_watch_stub();
var BasketValidationError = class extends Error {
  static {
    __name(this, "BasketValidationError");
  }
  code;
  constructor(message, code = "BASKET_VALIDATION_ERROR") {
    super(message);
    this.name = "BasketValidationError";
    this.code = code;
  }
};
var BasketClassificationGateError = class extends Error {
  static {
    __name(this, "BasketClassificationGateError");
  }
  productId;
  constructor(productId, reason) {
    super(`Basket item product ${productId} rejected by classification gate: ${reason}`);
    this.name = "BasketClassificationGateError";
    this.productId = productId;
  }
};
var BasketCombinationLimitError = class extends Error {
  static {
    __name(this, "BasketCombinationLimitError");
  }
  totalCombinations;
  limit;
  constructor(totalCombinations, limit) {
    super(
      `Basket requires ${totalCombinations} merchant combinations, which exceeds the maximum of ${limit}. Reduce the number of items or the number of merchants per item.`
    );
    this.name = "BasketCombinationLimitError";
    this.totalCombinations = totalCombinations;
    this.limit = limit;
  }
};
var MAX_BASKET_ITEMS = 10;
var MAX_CANDIDATE_MERCHANTS_PER_ITEM = 8;
var MAX_TOTAL_COMBINATIONS = 1e5;

// ../../packages/core-domain/src/optimizer/services/basket-optimizer.service.ts
function shippingKey(merchant, itemIndices) {
  return `${merchant}|${[...itemIndices].sort((a, b) => a - b).join(",")}`;
}
__name(shippingKey, "shippingKey");
var RELIABILITY_ORDER2 = [
  "VERIFIED",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
];
var BasketOptimizerService = class {
  constructor(classificationGate, calculator, basketShipping, productData, merchantTerms, calculationRecordPort, confidenceFramework) {
    this.classificationGate = classificationGate;
    this.calculator = calculator;
    this.basketShipping = basketShipping;
    this.productData = productData;
    this.merchantTerms = merchantTerms;
    this.calculationRecordPort = calculationRecordPort;
    this.confidenceFramework = confidenceFramework;
  }
  classificationGate;
  calculator;
  basketShipping;
  productData;
  merchantTerms;
  calculationRecordPort;
  confidenceFramework;
  /**
   * Optimize a multi-item basket — find the lowest-total combination of
   * merchant assignments.
   *
   * @throws {BasketValidationError}        items count > MAX_BASKET_ITEMS,
   *                                         or a quantity is not positive.
   * @throws {BasketClassificationGateError} a product fails the classification
   *                                         gate (same check the calculator
   *                                         would apply).
   * @throws {BasketCombinationLimitError}   the total combinations (product of
   *                                         per-item candidate counts) exceed
   *                                         MAX_TOTAL_COMBINATIONS.
   */
  async optimize(input) {
    this.validateInput(input);
    const { items, destination, transportArrangement, transportMethod, sessionId } = input;
    const resolvedItems = await this.resolveItems(items);
    const candidatesPerItem = this.buildCandidates(resolvedItems);
    this.guardCombinationCount(candidatesPerItem);
    const allMerchants = this.collectMerchants(candidatesPerItem);
    const termsMap = await this.fetchTerms(allMerchants);
    const itemCostMap = await this.computeItemCosts(
      items,
      resolvedItems,
      candidatesPerItem,
      destination,
      transportArrangement,
      transportMethod,
      sessionId
    );
    const shippingMemo = /* @__PURE__ */ new Map();
    for (const merchant of allMerchants) {
      const coverableIndices = [];
      for (let i = 0; i < candidatesPerItem.length; i++) {
        if (candidatesPerItem[i].some((c) => c.merchant === merchant)) {
          coverableIndices.push(i);
        }
      }
      if (coverableIndices.length === 0) continue;
      const firstOffer = candidatesPerItem[coverableIndices[0]].find(
        (c) => c.merchant === merchant
      );
      const originCountry = firstOffer?.offer.country;
      const n = coverableIndices.length;
      for (let mask = 1; mask < 1 << n; mask++) {
        const indices = [];
        for (let b = 0; b < n; b++) {
          if (mask & 1 << b) indices.push(coverableIndices[b]);
        }
        indices.sort((a, b) => a - b);
        const key = shippingKey(merchant, indices);
        const basketItems = indices.map((idx) => ({
          weightKg: resolvedItems[idx].product.weightKg * items[idx].quantity,
          packageType: resolvedItems[idx].product.containerType
        }));
        const shippingResult = await this.basketShipping.calculateBasket(
          basketItems,
          destination,
          transportMethod,
          originCountry
        );
        shippingMemo.set(key, {
          totalCents: shippingResult.totalCents,
          weightTier: shippingResult.weightTier,
          packageTier: shippingResult.packageTier,
          reliability: shippingResult.reliability
        });
      }
    }
    const assignments = [];
    const currentAssignment = [];
    this.dfsEnumerate(
      0,
      items,
      resolvedItems,
      candidatesPerItem,
      termsMap,
      itemCostMap,
      shippingMemo,
      currentAssignment,
      assignments,
      transportArrangement ?? "SELLER_ARRANGED"
    );
    if (assignments.length === 0) {
      throw new BasketValidationError(
        "No feasible merchant assignment found for the basket",
        "NO_FEASIBLE_ASSIGNMENT"
      );
    }
    this.sortAssignments(assignments);
    const best = assignments[0];
    const allConfidenceInputs = this.collectConfidenceInputs(
      best,
      termsMap,
      candidatesPerItem,
      itemCostMap
    );
    const confidenceReport = this.confidenceFramework.buildReport(allConfidenceInputs);
    const allVersions = this.collectDatasetVersions(best, candidatesPerItem, itemCostMap);
    const datasetVersions = [...new Set(allVersions)].sort();
    const alternatives = assignments.slice(1, 4).map((a) => {
      const altInputs = this.collectConfidenceInputs(a, termsMap, candidatesPerItem, itemCostMap);
      const altReport = this.confidenceFramework.buildReport(altInputs);
      return {
        shipments: a.shipments,
        totalCents: a.totalCents,
        itemizedTotals: a.itemizedTotals,
        confidence: altReport.overall,
        confidenceBreakdown: altReport.breakdown,
        disclaimer: DISCLAIMER_FI,
        metadata: {
          input: {
            items: [...input.items],
            destination: input.destination,
            transportArrangement: input.transportArrangement,
            transportMethod: input.transportMethod,
            sessionId: input.sessionId
          },
          calculationTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
          datasetVersions: [],
          calculationRecordId: null
        }
      };
    });
    const confidence = confidenceReport.overall;
    let calculationRecordId = null;
    if (this.calculationRecordPort) {
      const persisted = await this.calculationRecordPort.create({
        sessionId: sessionId ?? null,
        destination,
        transportArrangement: transportArrangement ?? "SELLER_ARRANGED",
        inputBasket: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        shipmentBreakdown: best.shipments,
        totalCents: best.totalCents,
        confidence,
        disclaimer: DISCLAIMER_FI.text
      });
      calculationRecordId = persisted.id;
    }
    return {
      shipments: best.shipments,
      totalCents: best.totalCents,
      itemizedTotals: best.itemizedTotals,
      confidence: confidenceReport.overall,
      confidenceBreakdown: confidenceReport.breakdown,
      disclaimer: DISCLAIMER_FI,
      alternatives,
      metadata: {
        input: {
          items: [...items],
          destination,
          transportArrangement,
          transportMethod,
          sessionId
        },
        calculationTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
        datasetVersions,
        calculationRecordId
      }
    };
  }
  // ---------------------------------------------------------------------------
  // Private: input validation
  // ---------------------------------------------------------------------------
  validateInput(input) {
    if (input.items.length > MAX_BASKET_ITEMS) {
      throw new BasketValidationError(
        `Basket contains ${input.items.length} items, maximum is ${MAX_BASKET_ITEMS}`,
        "TOO_MANY_ITEMS"
      );
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new BasketValidationError(
          `Invalid quantity ${item.quantity} for product ${item.productId}: must be a positive integer`,
          "INVALID_QUANTITY"
        );
      }
    }
  }
  /**
   * Reject baskets whose Cartesian product of per-item candidate merchants
   * exceeds MAX_TOTAL_COMBINATIONS, before terms fetch, cost computation,
   * shipping prefetch, or enumeration run.
   *
   * Each factor is at most MAX_CANDIDATE_MERCHANTS_PER_ITEM and there are at
   * most MAX_BASKET_ITEMS of them, so the product stays far below
   * Number.MAX_SAFE_INTEGER — plain multiplication needs no overflow care.
   */
  guardCombinationCount(candidatesPerItem) {
    let total = 1;
    for (const candidates of candidatesPerItem) {
      total *= candidates.length;
    }
    if (total > MAX_TOTAL_COMBINATIONS) {
      throw new BasketCombinationLimitError(total, MAX_TOTAL_COMBINATIONS);
    }
  }
  // ---------------------------------------------------------------------------
  // Private: prefetch helpers
  // ---------------------------------------------------------------------------
  async resolveItems(items) {
    const resolved = [];
    for (const item of items) {
      const product = await this.productData.findProductById(item.productId);
      if (product === null) {
        throw new BasketValidationError(
          `Product ${item.productId} not found`,
          "PRODUCT_NOT_FOUND"
        );
      }
      const gateResult = this.classificationGate.checkProductGate({
        regulatoryClassification: product.regulatoryClassification
      });
      if (!gateResult.passed) {
        throw new BasketClassificationGateError(
          item.productId,
          gateResult.reason
        );
      }
      const offers = await this.productData.findRetailOffers(item.productId);
      if (offers.length === 0) {
        throw new BasketValidationError(
          `No retail offers found for product ${item.productId}`,
          "NO_OFFERS"
        );
      }
      resolved.push({ productId: item.productId, product, offers });
    }
    return resolved;
  }
  buildCandidates(resolved) {
    return resolved.map((ri) => {
      const candidates = ri.offers.map((o) => ({
        merchant: o.merchant,
        offer: o
      }));
      candidates.sort((a, b) => {
        if (a.offer.priceCents !== b.offer.priceCents) {
          return a.offer.priceCents - b.offer.priceCents;
        }
        return a.merchant.localeCompare(b.merchant);
      });
      return candidates.slice(0, MAX_CANDIDATE_MERCHANTS_PER_ITEM);
    });
  }
  collectMerchants(candidates) {
    const set = /* @__PURE__ */ new Set();
    for (const cand of candidates) {
      for (const c of cand) set.add(c.merchant);
    }
    return [...set].sort();
  }
  async fetchTerms(merchants) {
    const map = /* @__PURE__ */ new Map();
    for (const m of merchants) {
      map.set(m, await this.merchantTerms.getTerms(m));
    }
    return map;
  }
  async computeItemCosts(items, resolvedItems, candidatesPerItem, destination, transportArrangement, transportMethod, sessionId) {
    const map = /* @__PURE__ */ new Map();
    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      const resolved = resolvedItems[itemIdx];
      for (const candidate of candidatesPerItem[itemIdx]) {
        const key = `${item.productId}|${candidate.merchant}`;
        if (map.has(key)) continue;
        const calcInput = {
          productId: item.productId,
          quantity: item.quantity,
          destination,
          transportArrangement,
          transportMethod,
          sessionId
        };
        const computed = await this.calculator.computeItemCosts(
          calcInput,
          resolved.product,
          candidate.offer,
          null
        );
        map.set(key, { computed, itemizedCosts: computed.itemizedCosts });
      }
    }
    return map;
  }
  // ---------------------------------------------------------------------------
  // Private: enumeration (DFS)
  // ---------------------------------------------------------------------------
  dfsEnumerate(itemIdx, items, resolvedItems, candidatesPerItem, termsMap, itemCostMap, shippingMemo, currentAssignment, assignments, transportArrangement) {
    if (itemIdx === items.length) {
      const assignment = this.evaluateAssignment(
        items,
        resolvedItems,
        candidatesPerItem,
        termsMap,
        itemCostMap,
        shippingMemo,
        currentAssignment,
        transportArrangement
      );
      if (assignment !== null) {
        assignments.push(assignment);
      }
      return;
    }
    for (let cand = 0; cand < candidatesPerItem[itemIdx].length; cand++) {
      currentAssignment.push(cand);
      this.dfsEnumerate(
        itemIdx + 1,
        items,
        resolvedItems,
        candidatesPerItem,
        termsMap,
        itemCostMap,
        shippingMemo,
        currentAssignment,
        assignments,
        transportArrangement
      );
      currentAssignment.pop();
    }
  }
  evaluateAssignment(items, _resolvedItems, candidatesPerItem, termsMap, itemCostMap, shippingMemo, assignment, transportArrangement) {
    const merchantToIndices = /* @__PURE__ */ new Map();
    for (let i = 0; i < assignment.length; i++) {
      const merchant = candidatesPerItem[i][assignment[i]].merchant;
      let indices = merchantToIndices.get(merchant);
      if (!indices) {
        indices = [];
        merchantToIndices.set(merchant, indices);
      }
      indices.push(i);
    }
    if (transportArrangement === "PERSONAL" && merchantToIndices.size > 1) {
      return null;
    }
    const shipments = [];
    let grandTotal = 0;
    let itemizedTotals = 0;
    for (const [merchant, indices] of merchantToIndices) {
      indices.sort((a, b) => a - b);
      const country = candidatesPerItem[indices[0]][assignment[indices[0]]].offer.country;
      const storeItems = [];
      let retailSubtotalCents = 0;
      for (const idx of indices) {
        const item = items[idx];
        const candidate = candidatesPerItem[idx][assignment[idx]];
        const costKey = `${item.productId}|${candidate.merchant}`;
        const record = itemCostMap.get(costKey);
        storeItems.push(record);
        retailSubtotalCents += record.computed.retailTotal;
      }
      const terms = termsMap.get(merchant) ?? null;
      const thresholdCheck = this.checkThreshold(terms, retailSubtotalCents);
      if (!thresholdCheck.meetsThreshold) {
        return null;
      }
      const shipKey = shippingKey(merchant, indices);
      const transport = shippingMemo.get(shipKey);
      const shipmentItems = storeItems.flatMap((r) => [...r.itemizedCosts]);
      const shipment = {
        merchant,
        country,
        items: shipmentItems,
        consolidatedTransport: transport,
        retailSubtotalCents,
        thresholdCheck
      };
      shipments.push(shipment);
      const shipmentTotal = retailSubtotalCents + transport.totalCents + storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
      grandTotal += shipmentTotal;
      itemizedTotals += retailSubtotalCents + storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
    }
    const storeKeys = [...merchantToIndices.keys()].sort().join("|");
    return { shipments, totalCents: grandTotal, itemizedTotals, storeKeys };
  }
  checkThreshold(terms, retailSubtotalCents) {
    if (terms === null || terms.minimumOrderValueCents === null) {
      return {
        minimumOrderValueCents: null,
        meetsThreshold: true,
        termsReliability: null
      };
    }
    const meets = retailSubtotalCents >= terms.minimumOrderValueCents;
    if (terms.reliabilityStatus === "VERIFIED" && !meets) {
      return {
        minimumOrderValueCents: terms.minimumOrderValueCents,
        meetsThreshold: false,
        termsReliability: terms.reliabilityStatus
      };
    }
    return {
      minimumOrderValueCents: terms.minimumOrderValueCents,
      meetsThreshold: true,
      termsReliability: terms.reliabilityStatus
    };
  }
  // ---------------------------------------------------------------------------
  // Private: selection
  // ---------------------------------------------------------------------------
  sortAssignments(assignments) {
    assignments.sort((a, b) => {
      if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
      if (a.shipments.length !== b.shipments.length) {
        return a.shipments.length - b.shipments.length;
      }
      return a.storeKeys.localeCompare(b.storeKeys);
    });
  }
  // ---------------------------------------------------------------------------
  // Private: confidence aggregation
  // ---------------------------------------------------------------------------
  /**
   * Collect every reliability status from the winning assignment and terms
   * data into an array that ConfidenceFrameworkService.buildReport can consume.
   *
   * Gathers across ALL shipments:
   * - Per-item retail/excise/container-duty/classification statuses
   *   (worst per category across all items)
   * - Per-shipment transport reliability
   * - Per-shipment threshold terms reliability (non-VERIFIED values
   *   included for confidence downgrade)
   */
  collectConfidenceInputs(assignment, _termsMap, _candidatesPerItem, itemCostMap) {
    const inputs = [];
    const worstPerCategory = /* @__PURE__ */ new Map();
    for (const shipment of assignment.shipments) {
      const transportRel = this.mapTransportReliability(shipment.consolidatedTransport.reliability);
      const existingTrans = worstPerCategory.get("transport");
      if (!existingTrans || this.isStricter(transportRel, existingTrans)) {
        worstPerCategory.set("transport", transportRel);
      }
    }
    for (const [, record] of itemCostMap) {
      const statusPairs = [
        { cat: "foreignRetailPrice", status: record.computed.retailStatus },
        { cat: "alcoholExciseEstimate", status: record.computed.exciseStatus },
        { cat: "containerDutyEstimate", status: record.computed.containerDutyStatus }
      ];
      for (const { cat, status } of statusPairs) {
        const existing = worstPerCategory.get(cat);
        if (!existing || this.isStricter(status, existing)) {
          worstPerCategory.set(cat, status);
        }
      }
      const existingClass = worstPerCategory.get("classification");
      if (!existingClass || this.isStricter(record.computed.classificationStatus, existingClass)) {
        worstPerCategory.set("classification", record.computed.classificationStatus);
      }
    }
    const categoryLabels = {
      foreignRetailPrice: "Price",
      transport: "Transport",
      alcoholExciseEstimate: "Excise",
      containerDutyEstimate: "Container duty",
      classification: "Classification"
    };
    for (const [cat, status] of worstPerCategory) {
      const label = categoryLabels[cat] ?? cat;
      inputs.push({ status, label });
    }
    const seenMerchants = /* @__PURE__ */ new Set();
    for (const shipment of assignment.shipments) {
      const tc = shipment.thresholdCheck;
      if (tc.termsReliability === null) continue;
      if (!seenMerchants.has(shipment.merchant)) {
        seenMerchants.add(shipment.merchant);
        inputs.push({
          status: tc.termsReliability,
          label: `Threshold terms (${shipment.merchant})`
        });
      }
    }
    return inputs;
  }
  /**
   * Whether `candidate` is stricter (worse) than `current`.
   * Higher index in RELIABILITY_ORDER = stricter = worse.
   */
  isStricter(candidate, current) {
    return RELIABILITY_ORDER2.indexOf(candidate) > RELIABILITY_ORDER2.indexOf(current);
  }
  /**
   * Map ConsolidatedTransportReliability to the domain ReliabilityStatus.
   */
  mapTransportReliability(rel) {
    switch (rel) {
      case "EXACT":
        return "VERIFIED";
      case "ESTIMATED":
        return "ESTIMATED";
      case "PARTIAL":
        return "UNAVAILABLE";
    }
  }
  // ---------------------------------------------------------------------------
  // Private: dataset versions
  // ---------------------------------------------------------------------------
  /**
   * Collect all dataset version strings from the ItemCostRecords referenced
   * by the winning assignment.
   *
   * Collects from the entire itemCostMap (union of all computed results that
   * could be used) — since the map is already deduplicated to one entry per
   * (product, merchant) pair, this covers exactly the set of tax/duty rule
   * versions that were involved.  Duplicates are removed via Set.
   */
  collectDatasetVersions(_assignment, _candidatesPerItem, itemCostMap) {
    const versions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const [, record] of itemCostMap) {
      for (const v of record.computed.datasetVersions) {
        if (!seen.has(v)) {
          seen.add(v);
          versions.push(v);
        }
      }
    }
    return versions;
  }
};
__name(BasketOptimizerService, "BasketOptimizerService");
BasketOptimizerService = __decorateClass([
  Injectable(),
  __decorateParam(3, Inject(PRODUCT_DATA_PORT)),
  __decorateParam(4, Inject(MERCHANT_TERMS_PORT)),
  __decorateParam(5, Optional()),
  __decorateParam(5, Inject(BASKET_CALCULATION_RECORD_PORT))
], BasketOptimizerService);

// ../../packages/core-domain/src/transport/basket-shipping-calculator.service.ts
init_modules_watch_stub();
function dominantPackageType(items) {
  if (items.length === 0) return "parcel";
  const counts = /* @__PURE__ */ new Map();
  for (const item of items) {
    counts.set(item.packageType, (counts.get(item.packageType) ?? 0) + 1);
  }
  let bestType = items[0].packageType;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestType = type;
    }
  }
  return bestType;
}
__name(dominantPackageType, "dominantPackageType");
var BasketShippingCalculator = class {
  constructor(offerQuery) {
    this.offerQuery = offerQuery;
  }
  offerQuery;
  /**
   * Estimate shipping cost for a basket of items shipped together.
   *
   * When transportMethod is provided, candidates are filtered by carrier AND
   * optional originCountry (matching TransportEstimationService.estimate()'s
   * behaviour).  When both originCountry and transportMethod are omitted,
   * all active offers for the destination + package tier are considered,
   * which may select a different carrier than the merchant's — callers
   * SHOULD always pass originCountry when the merchant's country is known.
   *
   * @param items            Items in the basket.
   * @param destination      Destination country code (ISO 3166-1 alpha-2).
   * @param transportMethod  Optional carrier or method identifier. When
   *                         omitted the service queries all active offers.
   * @param originCountry    Optional origin country code. When provided,
   *                         candidates are filtered to offers from this
   *                         origin, matching estimate()'s behaviour.
   */
  async calculateBasket(items, destination, transportMethod, originCountry) {
    const totalWeight = items.reduce((sum, i) => sum + i.weightKg, 0);
    const pkgTier = dominantPackageType(items);
    const offers = transportMethod ? await this.offerQuery.findByCarrier(transportMethod) : await this.offerQuery.findAllActive();
    const candidates = offers.filter(
      (o) => o.destinationCountry === destination && o.packageTier === pkgTier && (originCountry === void 0 || o.originCountry === originCountry)
    );
    if (candidates.length === 0) {
      return {
        totalWeight,
        weightTier: "UNAVAILABLE",
        packageTier: pkgTier,
        totalCents: 0,
        breakdown: items.map((item, idx) => ({
          itemIndex: idx,
          weightKg: item.weightKg,
          packageType: item.packageType,
          allocatedCents: 0
        })),
        reliability: "PARTIAL"
      };
    }
    let best;
    let reliability;
    if (items.length === 1) {
      const selection = selectBestBracketOffer(candidates, totalWeight);
      best = selection.offer;
      reliability = selection.reliability;
    } else {
      const exact = candidates.find((o) => inBracket(o, totalWeight));
      best = exact ?? candidates.reduce(
        (a, b) => a.priceCents < b.priceCents ? a : b
      );
      reliability = exact ? "EXACT" : totalWeight > 0 ? "ESTIMATED" : "PARTIAL";
    }
    const weightTier = best.weightBracket.minKg !== null || best.weightBracket.maxKg !== null ? `${best.weightBracket.minKg ?? 0}\u2013${best.weightBracket.maxKg ?? "\u221E"} kg` : "any";
    const breakdown = totalWeight > 0 ? items.map((item, idx) => ({
      itemIndex: idx,
      weightKg: item.weightKg,
      packageType: item.packageType,
      allocatedCents: Math.round(
        item.weightKg / totalWeight * best.priceCents
      )
    })) : items.map((item, idx) => ({
      itemIndex: idx,
      weightKg: item.weightKg,
      packageType: item.packageType,
      allocatedCents: 0
    }));
    const rawSum = breakdown.reduce((s, b) => s + b.allocatedCents, 0);
    const diff = best.priceCents - rawSum;
    if (diff !== 0 && breakdown.length > 0) {
      const largest = breakdown.reduce(
        (a, b) => a.allocatedCents >= b.allocatedCents ? a : b
      );
      largest.allocatedCents += diff;
    }
    return {
      totalWeight,
      weightTier,
      packageTier: pkgTier,
      totalCents: best.priceCents,
      breakdown,
      reliability
    };
  }
  /**
   * Check whether the basket qualifies for free shipping given a threshold.
   *
   * @param totalCents    The basket subtotal in euro-cents (product prices only).
   * @param thresholdCents Free-shipping threshold in euro-cents, or null if
   *                       no free-shipping offer exists for this merchant/route.
   */
  checkThreshold(totalCents, thresholdCents) {
    if (thresholdCents === null || thresholdCents <= 0) {
      return {
        freeShippingThresholdCents: null,
        qualifiesForFreeShipping: false,
        remainingToFreeCents: null
      };
    }
    const remaining = Math.max(0, thresholdCents - totalCents);
    return {
      freeShippingThresholdCents: thresholdCents,
      qualifiesForFreeShipping: remaining <= 0,
      remainingToFreeCents: remaining > 0 ? remaining : null
    };
  }
};
__name(BasketShippingCalculator, "BasketShippingCalculator");
BasketShippingCalculator = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(TRANSPORT_OFFER_QUERY))
], BasketShippingCalculator);

// ../../packages/core-domain/src/history/services/tax-change-attribution.service.ts
init_modules_watch_stub();
var AttributionInputError = class extends Error {
  static {
    __name(this, "AttributionInputError");
  }
  constructor(message) {
    super(message);
    this.name = "AttributionInputError";
  }
};
var TaxChangeAttributionService = class {
  /**
   * Classify every step between consecutive observations of one series.
   *
   * Classification counts COST-DRIVER categories, not raw inputs: excise
   * and container-duty boundaries together count as one driver ("tax
   * rules"), so a step where both rule versions changed while the merchant
   * price held is still a `TAX_RULE_CHANGE` — fully tax-driven, not MIXED.
   * `MIXED` means two or more different drivers moved simultaneously.
   *
   * A series with fewer than two observations yields no steps.
   *
   * @throws {AttributionInputError} If observations are not in ascending
   *   observedAt order or do not belong to a single (productId, merchant)
   *   series.
   */
  attribute(input) {
    assertSingleSeries(input.observations);
    const steps = [];
    for (let i = 1; i < input.observations.length; i++) {
      const previous = input.observations[i - 1];
      const next = input.observations[i];
      steps.push(
        attributeStep(previous, next, input.exciseRuleWindows, input.containerDutyRuleWindows)
      );
    }
    return steps;
  }
};
__name(TaxChangeAttributionService, "TaxChangeAttributionService");
TaxChangeAttributionService = __decorateClass([
  Injectable()
], TaxChangeAttributionService);
function attributeStep(previous, next, exciseRuleWindows, containerDutyRuleWindows) {
  const exciseRuleBoundary = resolveRuleBoundary(
    exciseRuleWindows,
    previous.observedAt,
    next.observedAt
  );
  const containerDutyRuleBoundary = resolveRuleBoundary(
    containerDutyRuleWindows,
    previous.observedAt,
    next.observedAt
  );
  const movedInputs = {
    exciseRule: exciseRuleBoundary !== null,
    containerDutyRule: containerDutyRuleBoundary !== null,
    merchantPrice: previous.foreignRetailPriceCents !== next.foreignRetailPriceCents,
    transport: previous.transportCostCents !== next.transportCostCents
  };
  return {
    classification: classifyMovedInputs(movedInputs),
    fromObservedAt: previous.observedAt,
    toObservedAt: next.observedAt,
    movedInputs,
    exciseRuleBoundary,
    containerDutyRuleBoundary
  };
}
__name(attributeStep, "attributeStep");
function classifyMovedInputs(moved) {
  const taxRuleDriver = moved.exciseRule || moved.containerDutyRule;
  const movedDrivers = [taxRuleDriver, moved.merchantPrice, moved.transport].filter(
    (driverMoved) => driverMoved
  ).length;
  if (movedDrivers === 0) return "UNCHANGED";
  if (movedDrivers > 1) return "MIXED";
  if (taxRuleDriver) return "TAX_RULE_CHANGE";
  if (moved.merchantPrice) return "MERCHANT_PRICE_CHANGE";
  return "TRANSPORT_CHANGE";
}
__name(classifyMovedInputs, "classifyMovedInputs");
function resolveRuleBoundary(windows, fromInstant, toInstant2) {
  const fromVersionLabel = resolveVersionLabelAt(windows, fromInstant);
  const toVersionLabel = resolveVersionLabelAt(windows, toInstant2);
  return fromVersionLabel === toVersionLabel ? null : { fromVersionLabel, toVersionLabel };
}
__name(resolveRuleBoundary, "resolveRuleBoundary");
function resolveVersionLabelAt(windows, instant) {
  let effective = null;
  for (const window of windows) {
    const coversInstant = window.effectiveFrom.getTime() <= instant.getTime() && (window.effectiveTo === null || window.effectiveTo.getTime() > instant.getTime());
    if (coversInstant && (effective === null || window.effectiveFrom > effective.effectiveFrom)) {
      effective = window;
    }
  }
  return effective === null ? null : effective.versionLabel;
}
__name(resolveVersionLabelAt, "resolveVersionLabelAt");
function assertSingleSeries(observations) {
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1];
    const next = observations[i];
    if (previous.observedAt > next.observedAt) {
      throw new AttributionInputError(
        `Observations must be ordered by observedAt ascending: index ${i - 1} (${previous.observedAt.toISOString()}) is after index ${i} (${next.observedAt.toISOString()})`
      );
    }
    if (previous.productId !== next.productId || previous.merchant !== next.merchant) {
      throw new AttributionInputError(
        `Observations must belong to one (productId, merchant) series: index ${i} differs from index ${i - 1}`
      );
    }
  }
}
__name(assertSingleSeries, "assertSingleSeries");

// ../../packages/core-domain/src/declaration/declaration.types.ts
init_modules_watch_stub();
var CALCULATION_RECORD_QUERY_PORT = "CALCULATION_RECORD_QUERY_PORT";
var NO_SUBMISSION_GUARANTEE = "This module never submits data to any external service";
var CalculationRecordNotFoundError = class extends Error {
  static {
    __name(this, "CalculationRecordNotFoundError");
  }
  calculationRecordId;
  constructor(calculationRecordId) {
    super(`Calculation record ${calculationRecordId} not found`);
    this.name = "CalculationRecordNotFoundError";
    this.calculationRecordId = calculationRecordId;
  }
};

// ../../packages/core-domain/src/declaration/excise-declaration.service.ts
init_modules_watch_stub();
function getAdvanceNoticeInfo(classification) {
  switch (classification) {
    case "TravellerImport":
      return { required: true, deadlineDays: 4 };
    case "DistanceSelling":
    case "DistanceBuying":
      return { required: false };
  }
}
__name(getAdvanceNoticeInfo, "getAdvanceNoticeInfo");
function mapDisclaimer(text, language, version) {
  return { text, language, version };
}
__name(mapDisclaimer, "mapDisclaimer");
var MYTAX_LINK = "https://www.vero.fi/asioi-verkossa/mytax/";
var FALLBACK_RULE_VERSION_LABEL = "FALLBACK";
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var EXCISE_FORMULA_DETAILS = {
  PER_LITRE_OF_PRODUCT: {
    unit: "litre of product",
    expression: "excise = rate \xD7 litres of product"
  },
  PER_LITRE_OF_ALCOHOL: {
    unit: "litre of pure alcohol",
    expression: "excise = rate \xD7 volume \xD7 ABV (litres of pure alcohol)"
  },
  PER_CENTILITRE_ETHANOL: {
    unit: "centilitre of ethyl alcohol",
    expression: "excise = rate \xD7 ABV \xD7 volume (centilitres of ethanol; numerically per %-litre)"
  }
};
var CONTAINER_DUTY_FORMULA = {
  reference: "FLAT_PER_LITRE",
  unit: "litre of product",
  expression: "container duty = rate \xD7 litres of product"
};
var MYTAX_ENTRY_CHECKLIST = [
  "Records observed in similar Finnish excise filings begin from the transaction classification \u2014 distance selling, distance buying, or traveller import \u2014 which determines who declares the duty.",
  "Entries observed in comparable MyTax excise declarations list the product category, alcohol by volume, container volume, and quantity as separate fields, matching the derivation above.",
  "Declarations of this kind observed in vero.fi guidance include the total volume across all units (volume per unit \xD7 quantity) as one summed figure.",
  "Observed filings state the alcohol excise amount and the beverage-container duty amount as separate line items rather than a single combined figure.",
  "Records observed in comparable submissions reference the calculation timestamp and the applied rule versions so each entered figure stays traceable.",
  "Observed declarations end with the filer reviewing each entered figure against their own records before submitting in MyTax."
];
var OFFICIAL_SOURCES = [
  {
    title: "Alcohol excise duty (vero.fi)",
    url: "https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/alkoholi/",
    description: "Official Tax Administration guidance on Finnish alcohol excise duty \u2014 categories, rates, and formulas."
  },
  {
    title: "Excise duties (vero.fi)",
    url: "https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/",
    description: "Official Tax Administration overview of Finnish excise duties, including beverage container duty."
  }
];
function computeAdvanceNoticeDueDate(calculationTimestamp, deadlineDays) {
  const ts = new Date(calculationTimestamp);
  if (Number.isNaN(ts.getTime())) {
    return null;
  }
  return new Date(ts.getTime() + deadlineDays * MS_PER_DAY).toISOString().slice(0, 10);
}
__name(computeAdvanceNoticeDueDate, "computeAdvanceNoticeDueDate");
function buildDerivation(record) {
  const exciseFormulaReference = record.exciseFormulaReference ?? null;
  const exciseFormula = exciseFormulaReference !== null ? EXCISE_FORMULA_DETAILS[exciseFormulaReference] ?? null : null;
  const appliedRates = [
    {
      kind: "alcoholExcise",
      amountCents: record.alcoholExciseCents,
      ratePerUnit: record.alcoholExciseRatePerUnit ?? null,
      rateUnit: exciseFormula?.unit ?? null,
      ruleVersionLabel: record.exciseRuleVersionLabel ?? null,
      formulaReference: exciseFormulaReference,
      formulaExpression: exciseFormula?.expression ?? null
    },
    {
      kind: "containerDuty",
      amountCents: record.containerDutyCents,
      ratePerUnit: record.containerDutyRatePerLitre ?? null,
      rateUnit: CONTAINER_DUTY_FORMULA.unit,
      ruleVersionLabel: record.containerDutyRuleVersionLabel ?? null,
      formulaReference: CONTAINER_DUTY_FORMULA.reference,
      formulaExpression: CONTAINER_DUTY_FORMULA.expression
    }
  ];
  return {
    category: record.productCategory,
    abvPercent: record.alcoholByVolume,
    volumePerUnitLitres: record.volumeLitres,
    quantity: record.quantity,
    totalVolumeLitres: record.volumeLitres * record.quantity,
    appliedRates
  };
}
__name(buildDerivation, "buildDerivation");
function buildDeadline(calculationTimestamp, advanceNoticeInfo) {
  const deadlineDays = advanceNoticeInfo.required ? advanceNoticeInfo.deadlineDays ?? null : null;
  return {
    required: advanceNoticeInfo.required,
    deadlineDays,
    calculatedFrom: calculationTimestamp,
    dueDate: deadlineDays !== null ? computeAdvanceNoticeDueDate(calculationTimestamp, deadlineDays) : null
  };
}
__name(buildDeadline, "buildDeadline");
function buildCaveats(record) {
  const caveats = [];
  if (record.confidence === "LOW") {
    caveats.push(
      "Overall calculation confidence is LOW \u2014 one or more inputs were stale or unavailable when the record was computed; verify the figures against current sources before use."
    );
  }
  if (record.depositSystemStatus === null) {
    caveats.push(
      "Deposit-return system participation is unknown for this container; the container-duty figure is an ESTIMATED standard-rate amount, not a confirmed charge or exemption."
    );
  }
  if (record.exciseRuleVersionLabel === FALLBACK_RULE_VERSION_LABEL) {
    caveats.push(
      "The alcohol-excise figure was produced from the engine fallback dataset (no matching tax rule for the calculation date) rather than an official schedule version."
    );
  }
  if (record.containerDutyRuleVersionLabel === FALLBACK_RULE_VERSION_LABEL) {
    caveats.push(
      "The container-duty figure was produced from the engine fallback dataset (no matching tax rule for the calculation date) rather than an official schedule version."
    );
  }
  const rateProvenanceMissing = record.alcoholExciseRatePerUnit == null || record.exciseRuleVersionLabel == null || record.exciseFormulaReference == null || record.containerDutyRatePerLitre == null || record.containerDutyRuleVersionLabel == null;
  if (rateProvenanceMissing) {
    caveats.push(
      "The calculation record does not persist every applied rate or rule version; the derivation shows the recorded cents totals and marks the per-unit rates unavailable rather than reconstructing them."
    );
  }
  return caveats;
}
__name(buildCaveats, "buildCaveats");
function buildGuidance(record, advanceNoticeInfo) {
  return {
    derivation: buildDerivation(record),
    deadline: buildDeadline(record.calculationTimestamp, advanceNoticeInfo),
    checklist: MYTAX_ENTRY_CHECKLIST,
    caveats: buildCaveats(record),
    officialSources: OFFICIAL_SOURCES
  };
}
__name(buildGuidance, "buildGuidance");
var ExciseDeclarationService = class {
  constructor(recordQuery) {
    this.recordQuery = recordQuery;
  }
  recordQuery;
  /**
   * Runtime guarantee — this service never submits data to any external
   * service.  Read-only by design.
   */
  noSubmissionGuarantee = NO_SUBMISSION_GUARANTEE;
  /**
   * Prepare a structured declaration summary from a completed calculation
   * record.
   *
   * @param calculationRecordId — ID of the persisted calculation record.
   * @returns A DeclarationSummary ready for review or export.
   * @throws {CalculationRecordNotFoundError} when the record does not exist.
   */
  async prepareDeclaration(calculationRecordId) {
    const record = await this.recordQuery.findById(calculationRecordId);
    if (record === null) {
      throw new CalculationRecordNotFoundError(calculationRecordId);
    }
    return this.assembleSummary(record);
  }
  // ---------------------------------------------------------------------------
  // Private — assembly
  // ---------------------------------------------------------------------------
  assembleSummary(record) {
    const advanceNoticeInfo = getAdvanceNoticeInfo(record.classification);
    const totalExciseCents = record.alcoholExciseCents + record.containerDutyCents;
    return {
      product: {
        name: record.productName,
        brand: record.productBrand,
        category: record.productCategory,
        abv: record.alcoholByVolume,
        volumeLitres: record.volumeLitres
      },
      units: record.quantity,
      container: {
        type: record.containerType,
        volumeLitres: record.volumeLitres,
        depositSystemStatus: record.depositSystemStatus
      },
      transport: {
        carrier: record.transportCarrier,
        origin: record.transportOrigin,
        destination: record.transportDestination
      },
      estimatedExcise: {
        alcoholExciseCents: record.alcoholExciseCents,
        containerDutyCents: record.containerDutyCents,
        totalCents: totalExciseCents,
        confidence: record.confidence
      },
      advanceNoticeInfo,
      myTaxLink: MYTAX_LINK,
      declarationDate: record.calculationTimestamp,
      disclaimer: mapDisclaimer(
        record.disclaimerText,
        record.disclaimerLanguage,
        record.disclaimerVersion
      ),
      guidance: buildGuidance(record, advanceNoticeInfo)
    };
  }
};
__name(ExciseDeclarationService, "ExciseDeclarationService");
ExciseDeclarationService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(CALCULATION_RECORD_QUERY_PORT))
], ExciseDeclarationService);
var _readonlySurface = new ExciseDeclarationService();

// src/adapters/d1-domain-ports.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/calculation-record.repository.ts
init_modules_watch_stub();
function toContractRecord(row) {
  return {
    id: row.id,
    productMasterId: row.product_master_id,
    retailOfferIds: row.retail_offer_ids === null ? null : JSON.parse(row.retail_offer_ids),
    transportOfferId: row.transport_offer_id,
    exciseRuleVersionId: row.excise_rule_version_id,
    containerDutyRuleVersionId: row.container_duty_rule_version_id,
    totalCents: row.total_cents,
    breakdown: JSON.parse(row.breakdown),
    confidence: row.confidence,
    quantity: row.quantity,
    destination: row.destination,
    disclaimer: row.disclaimer,
    sessionId: row.session_id,
    calculatedAt: new Date(row.calculated_at)
  };
}
__name(toContractRecord, "toContractRecord");
var RECORD_COLUMNS = `
  id, product_master_id, retail_offer_ids, transport_offer_id,
  excise_rule_version_id, container_duty_rule_version_id, total_cents,
  breakdown, confidence, quantity, destination, disclaimer, session_id,
  calculated_at`;
var NEXT_ID_SQL = `
  SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM calculation_records`;
var INSERT_COLUMNS = `(id, product_master_id, retail_offer_ids, transport_offer_id, excise_rule_version_id, container_duty_rule_version_id, total_cents, breakdown, confidence, quantity, destination, disclaimer, session_id, calculated_at)`;
var FIND_BY_ID_SQL = `
  SELECT ${RECORD_COLUMNS} FROM calculation_records
   WHERE id = ? ORDER BY calculated_at ASC LIMIT 1`;
var FIND_BY_SESSION_SQL = `
  SELECT ${RECORD_COLUMNS} FROM calculation_records
   WHERE session_id = ? ORDER BY calculated_at ASC`;
var LINK_SESSION_SQL = `
  UPDATE calculation_records SET session_id = ?
   WHERE id = ? AND session_id IS NULL
   RETURNING id`;
var HISTORY_ENTRIES_SQL = `
  SELECT c.id AS calculation_id, c.calculated_at, c.total_cents,
         c.quantity, p.name AS product_name
    FROM calculation_records c
   INNER JOIN product_master p ON c.product_master_id = p.id
   WHERE c.session_id = ?
   ORDER BY c.calculated_at ASC`;
var FIND_IDS_BY_OFFER_SQL = `
  SELECT id FROM calculation_records
   WHERE retail_offer_ids IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM json_each(calculation_records.retail_offer_ids)
        WHERE json_each.value = ?
     )`;
var FIND_IDS_BY_PRODUCT_SQL = `
  SELECT id FROM calculation_records WHERE product_master_id = ?`;
var FIND_IDS_BY_TRANSPORT_SQL = `
  SELECT id FROM calculation_records WHERE transport_offer_id = ?`;
var FIND_IDS_BY_TAX_RULE_SQL = `
  SELECT id FROM calculation_records
   WHERE excise_rule_version_id = ? OR container_duty_rule_version_id = ?`;
var D1CalculationRecordRepository = class extends CalculationRecordRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async create(record) {
    const id = record.id ?? (await this.d1.prepare(NEXT_ID_SQL).first())?.next_id;
    if (id === void 0) {
      throw new Error("calculation_records id assignment returned no row");
    }
    const calculatedAt = record.calculatedAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString();
    const row = await this.d1.prepare(
      `INSERT INTO calculation_records ${INSERT_COLUMNS}
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${RECORD_COLUMNS}`
    ).bind(
      id,
      record.productMasterId,
      record.retailOfferIds == null ? null : JSON.stringify(record.retailOfferIds),
      record.transportOfferId ?? null,
      record.exciseRuleVersionId ?? null,
      record.containerDutyRuleVersionId ?? null,
      record.totalCents,
      JSON.stringify(record.breakdown),
      record.confidence,
      record.quantity,
      record.destination,
      record.disclaimer,
      record.sessionId ?? null,
      calculatedAt
    ).first();
    if (!row) {
      throw new Error("calculation_records INSERT .. RETURNING returned no row");
    }
    return toContractRecord(row);
  }
  /** @inheritdoc */
  async findById(id) {
    const row = await this.d1.prepare(FIND_BY_ID_SQL).bind(id).first();
    return row ? toContractRecord(row) : null;
  }
  /** @inheritdoc */
  async findBySession(sessionId) {
    const rows = (await this.d1.prepare(FIND_BY_SESSION_SQL).bind(sessionId).all()).results;
    return rows.map(toContractRecord);
  }
  /**
   * Claim an anonymous record for a session account: first claim wins.
   * The UPDATE's `session_id IS NULL` guard makes the claim atomic — a
   * concurrent second claim matches no row and returns false.
   */
  async linkSession(recordId, sessionId) {
    const result = await this.d1.prepare(LINK_SESSION_SQL).bind(sessionId, recordId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
  /** @inheritdoc */
  async findHistoryEntriesBySession(sessionId) {
    const rows = (await this.d1.prepare(HISTORY_ENTRIES_SQL).bind(sessionId).all()).results;
    return rows.map((row) => ({
      calculationId: row.calculation_id,
      calculatedAt: new Date(row.calculated_at),
      totalCents: row.total_cents,
      quantity: row.quantity,
      productName: row.product_name
    }));
  }
  /** @inheritdoc */
  async findCalculationRecordIdsByEntity(entityType, entityId) {
    let statement;
    switch (entityType) {
      case "product":
        statement = this.d1.prepare(FIND_IDS_BY_PRODUCT_SQL).bind(entityId);
        break;
      case "retailOffer":
        statement = this.d1.prepare(FIND_IDS_BY_OFFER_SQL).bind(entityId);
        break;
      case "transportOffer":
        statement = this.d1.prepare(FIND_IDS_BY_TRANSPORT_SQL).bind(entityId);
        break;
      case "taxRule":
        statement = this.d1.prepare(FIND_IDS_BY_TAX_RULE_SQL).bind(entityId, entityId);
        break;
      default:
        return [];
    }
    const rows = (await statement.all()).results;
    return rows.map((r) => r.id);
  }
};
__name(D1CalculationRecordRepository, "D1CalculationRecordRepository");
D1CalculationRecordRepository = __decorateClass([
  Injectable()
], D1CalculationRecordRepository);

// ../../packages/data-platform/src/repositories/d1/merchant-terms.repository.ts
init_modules_watch_stub();
function toContractTerms(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    minimumOrderValueCents: row.minimum_order_value_cents,
    currency: row.currency,
    sourceUrl: row.source_url,
    reliabilityStatus: row.reliability_status,
    observedAt: new Date(row.observed_at)
  };
}
__name(toContractTerms, "toContractTerms");
var TERMS_COLUMNS = `
  id, merchant_id, minimum_order_value_cents, currency, source_url,
  reliability_status, observed_at`;
var FIND_BY_MERCHANT_SQL = `
  SELECT ${TERMS_COLUMNS} FROM merchant_terms WHERE merchant_id = ?`;
var UPSERT_SQL = `
  INSERT INTO merchant_terms (
    merchant_id, minimum_order_value_cents, currency, source_url,
    reliability_status, observed_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (merchant_id) DO UPDATE SET
    minimum_order_value_cents = excluded.minimum_order_value_cents,
    currency = excluded.currency,
    source_url = excluded.source_url,
    reliability_status = excluded.reliability_status,
    observed_at = excluded.observed_at
  RETURNING ${TERMS_COLUMNS}`;
var D1MerchantTermsRepository = class extends MerchantTermsRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async findByMerchant(merchantId) {
    const row = await this.d1.prepare(FIND_BY_MERCHANT_SQL).bind(merchantId).first();
    return row ? toContractTerms(row) : null;
  }
  /** @inheritdoc */
  async upsert(record) {
    const row = await this.d1.prepare(UPSERT_SQL).bind(
      record.merchantId,
      record.minimumOrderValueCents ?? null,
      record.currency,
      record.sourceUrl ?? null,
      record.reliabilityStatus ?? "ESTIMATED",
      record.observedAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString()
    ).first();
    if (!row) {
      throw new Error("merchant_terms upsert .. RETURNING returned no row");
    }
    return toContractTerms(row);
  }
};
__name(D1MerchantTermsRepository, "D1MerchantTermsRepository");
D1MerchantTermsRepository = __decorateClass([
  Injectable()
], D1MerchantTermsRepository);

// ../../packages/data-platform/src/repositories/d1/basket-calculation-record.repository.ts
init_modules_watch_stub();
function toContractRecord2(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    destination: row.destination,
    transportArrangement: row.transport_arrangement,
    inputBasket: JSON.parse(row.input_basket),
    shipmentBreakdown: JSON.parse(row.shipment_breakdown),
    totalCents: row.total_cents,
    confidence: row.confidence,
    disclaimer: row.disclaimer,
    createdAt: new Date(row.created_at)
  };
}
__name(toContractRecord2, "toContractRecord");
var RECORD_COLUMNS2 = `
  id, session_id, destination, transport_arrangement, input_basket,
  shipment_breakdown, total_cents, confidence, disclaimer, created_at`;
var NEXT_ID_SQL2 = `
  SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM basket_calculation_records`;
var FIND_BY_ID_SQL2 = `
  SELECT ${RECORD_COLUMNS2} FROM basket_calculation_records
   WHERE id = ? ORDER BY created_at ASC LIMIT 1`;
var INSERT_SQL2 = `
  INSERT INTO basket_calculation_records (
    id, session_id, destination, transport_arrangement, input_basket,
    shipment_breakdown, total_cents, confidence, disclaimer, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${RECORD_COLUMNS2}`;
var D1BasketCalculationRecordRepository = class extends BasketCalculationRecordRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async create(record) {
    const id = record.id ?? (await this.d1.prepare(NEXT_ID_SQL2).first())?.next_id;
    if (id === void 0) {
      throw new Error("basket_calculation_records id assignment returned no row");
    }
    const row = await this.d1.prepare(INSERT_SQL2).bind(
      id,
      record.sessionId ?? null,
      record.destination,
      record.transportArrangement,
      JSON.stringify(record.inputBasket),
      JSON.stringify(record.shipmentBreakdown),
      record.totalCents,
      record.confidence,
      record.disclaimer,
      record.createdAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString()
    ).first();
    if (!row) {
      throw new Error(
        "basket_calculation_records INSERT .. RETURNING returned no row"
      );
    }
    return toContractRecord2(row);
  }
  /** @inheritdoc */
  async findById(id) {
    const row = await this.d1.prepare(FIND_BY_ID_SQL2).bind(id).first();
    return row ? toContractRecord2(row) : null;
  }
};
__name(D1BasketCalculationRecordRepository, "D1BasketCalculationRecordRepository");
D1BasketCalculationRecordRepository = __decorateClass([
  Injectable()
], D1BasketCalculationRecordRepository);

// src/adapters/d1-domain-ports.ts
function parseNumeric(value) {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}
__name(parseNumeric, "parseNumeric");
function estimateWeightKg(volumeLitres) {
  return volumeLitres * 1;
}
__name(estimateWeightKg, "estimateWeightKg");
function toReliabilityStatus(value) {
  return value === "VERIFIED" || value === "STALE" || value === "UNAVAILABLE" ? value : "ESTIMATED";
}
__name(toReliabilityStatus, "toReliabilityStatus");
var D1ProductDataPort = class {
  constructor(repo) {
    this.repo = repo;
  }
  repo;
  static {
    __name(this, "D1ProductDataPort");
  }
  /** @inheritdoc */
  async findProductById(id) {
    const record = await this.repo.findById(id);
    if (record === null) return null;
    const volumeLitres = parseNumeric(record.unitVolume);
    return {
      id: record.id,
      regulatoryClassification: record.regulatoryClassification,
      category: record.category,
      volumeLitres,
      alcoholByVolume: record.alcoholByVolume !== null ? parseNumeric(record.alcoholByVolume) : 0,
      containerType: record.containerType,
      depositSystemStatus: record.depositSystemStatus,
      weightKg: estimateWeightKg(volumeLitres),
      normalizedName: record.name
    };
  }
  /**
   * @inheritdoc
   *
   * Conversion-state columns (design D2 / task 1.5) pass through so live
   * offers carry their FX provenance: `hasValidEurConversion` excludes
   * offers whose non-EUR original lacks a recorded FX dataset version.
   * Null columns are omitted rather than nulled — "absent" is the
   * read-model state the domain contract expects for unknown provenance.
   */
  async findRetailOffers(productId) {
    const offers = await this.repo.findOffers(productId);
    return offers.map((o) => ({
      id: o.id,
      priceCents: o.priceCents,
      currency: o.currency,
      merchant: o.merchant,
      country: o.country,
      reliabilityStatus: toReliabilityStatus(o.reliabilityStatus),
      ...o.originalPriceCents !== null ? { originalPriceCents: o.originalPriceCents } : {},
      ...o.originalCurrency !== null ? { originalCurrency: o.originalCurrency } : {},
      ...o.fxDatasetVersion !== null ? { fxDatasetVersion: o.fxDatasetVersion } : {}
    }));
  }
};
function toDomainOffer(row) {
  return {
    id: row.id,
    carrier: row.carrier,
    originCountry: row.originCountry,
    destinationCountry: row.destinationCountry,
    weightBracket: {
      minKg: row.weightMinKg === null ? null : Number(row.weightMinKg),
      maxKg: row.weightMaxKg === null ? null : Number(row.weightMaxKg)
    },
    packageTier: row.packageTier,
    priceCents: row.priceCents,
    currency: row.currency,
    sellerInvolvementIndicator: row.sellerInvolvementIndicator,
    observedAt: row.observedAt,
    refreshedAt: row.refreshedAt,
    reliabilityStatus: row.reliabilityStatus
  };
}
__name(toDomainOffer, "toDomainOffer");
var D1TransportOfferQuery = class {
  constructor(repo) {
    this.repo = repo;
  }
  repo;
  static {
    __name(this, "D1TransportOfferQuery");
  }
  /** @inheritdoc */
  async findAllActive() {
    const rows = await this.repo.findActive();
    return rows.map(toDomainOffer);
  }
  /** @inheritdoc */
  async findByCarrier(carrierId) {
    const rows = await this.repo.findByCarrier(carrierId);
    return rows.map(toDomainOffer);
  }
};
var INSERT_TRANSPORT_OFFER_SQL = `
  INSERT INTO transport_offers (
    carrier, origin_country, destination_country, weight_min_kg,
    weight_max_kg, package_tier, price_cents, currency,
    seller_involvement_indicator, observed_at, refreshed_at,
    reliability_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
var NEWEST_OBSERVED_AT_SQL = `
  SELECT MAX(observed_at) AS newest FROM transport_offers`;
var D1TransportOfferWritePort = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  static {
    __name(this, "D1TransportOfferWritePort");
  }
  /** @inheritdoc */
  async insertOffers(offers) {
    if (offers.length === 0) return { inserted: 0 };
    const refreshedAt = (/* @__PURE__ */ new Date()).toISOString();
    await this.d1.batch(
      offers.map(
        ({ rate, reliabilityStatus }) => this.d1.prepare(INSERT_TRANSPORT_OFFER_SQL).bind(
          rate.carrier,
          rate.originCountry,
          rate.destinationCountry,
          rate.weightMinKg,
          rate.weightMaxKg,
          rate.packageTier,
          rate.priceCents,
          rate.currency,
          // Tri-state-free column: boolean → INTEGER (design D2).
          rate.sellerInvolvementIndicator ? 1 : 0,
          rate.observedAt.toISOString(),
          refreshedAt,
          reliabilityStatus
        )
      )
    );
    return { inserted: offers.length };
  }
  /** @inheritdoc */
  async findNewestObservedAt() {
    const row = await this.d1.prepare(NEWEST_OBSERVED_AT_SQL).first();
    return row?.newest ? new Date(row.newest) : null;
  }
};
var D1CalculationRecordPort = class {
  static {
    __name(this, "D1CalculationRecordPort");
  }
  repo;
  constructor(d1) {
    this.repo = new D1CalculationRecordRepository(d1);
  }
  /** @inheritdoc */
  async create(record) {
    const persisted = await this.repo.create({
      productMasterId: record.productMasterId,
      retailOfferIds: record.retailOfferIds,
      transportOfferId: record.transportOfferId,
      exciseRuleVersionId: record.exciseRuleVersionId,
      containerDutyRuleVersionId: record.containerDutyRuleVersionId,
      totalCents: record.totalCents,
      breakdown: record.breakdown,
      confidence: record.confidence,
      quantity: record.quantity,
      destination: record.destination,
      disclaimer: JSON.stringify(record.disclaimer),
      sessionId: record.sessionId
    });
    return { id: persisted.id };
  }
};
var RECORD_QUERY_SQL = `
  SELECT r.id, r.total_cents, r.breakdown, r.confidence, r.quantity,
         r.destination, r.disclaimer, r.calculated_at,
         p.name AS product_name, p.brand AS product_brand,
         p.category AS product_category, p.alcohol_by_volume,
         p.unit_volume, p.container_type, p.deposit_system_status,
         t.carrier AS transport_carrier, t.origin_country AS transport_origin,
         t.destination_country AS transport_destination
    FROM calculation_records r
    JOIN product_master p ON p.id = r.product_master_id
    LEFT JOIN transport_offers t ON t.id = r.transport_offer_id
   WHERE r.id = ?
   ORDER BY r.calculated_at ASC
   LIMIT 1`;
function sumBreakdownCategory(breakdown, category) {
  if (!Array.isArray(breakdown)) return 0;
  let sum = 0;
  for (const raw2 of breakdown) {
    if (typeof raw2 === "object" && raw2 !== null) {
      const entry = raw2;
      if (entry.category === category && typeof entry.cents === "number") {
        sum += entry.cents;
      }
    }
  }
  return sum;
}
__name(sumBreakdownCategory, "sumBreakdownCategory");
function parseDisclaimer(raw2) {
  try {
    const parsed = JSON.parse(raw2);
    if (typeof parsed.text === "string" && (parsed.language === "fi" || parsed.language === "en") && typeof parsed.version === "string") {
      return { text: parsed.text, language: parsed.language, version: parsed.version };
    }
  } catch {
  }
  return { text: raw2, language: "fi", version: "unknown" };
}
__name(parseDisclaimer, "parseDisclaimer");
var D1CalculationRecordQueryAdapter = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  static {
    __name(this, "D1CalculationRecordQueryAdapter");
  }
  /** @inheritdoc */
  async findById(id) {
    const row = await this.d1.prepare(RECORD_QUERY_SQL).bind(id).first();
    if (row === null) return null;
    let breakdown = null;
    try {
      breakdown = JSON.parse(row.breakdown);
    } catch {
      breakdown = null;
    }
    const disclaimer = parseDisclaimer(row.disclaimer);
    return {
      id: row.id,
      productName: row.product_name,
      productBrand: row.product_brand,
      productCategory: row.product_category,
      alcoholByVolume: parseNumeric(row.alcohol_by_volume ?? ""),
      volumeLitres: parseNumeric(row.unit_volume ?? ""),
      containerType: row.container_type,
      depositSystemStatus: row.deposit_system_status === null ? null : row.deposit_system_status === 1,
      quantity: row.quantity,
      transportCarrier: row.transport_carrier,
      transportOrigin: row.transport_origin,
      transportDestination: row.transport_destination,
      alcoholExciseCents: sumBreakdownCategory(breakdown, "alcoholExciseEstimate"),
      containerDutyCents: sumBreakdownCategory(breakdown, "containerDutyEstimate"),
      totalCents: row.total_cents,
      confidence: row.confidence === "HIGH" || row.confidence === "MEDIUM" ? row.confidence : "LOW",
      classification: "NotPersisted",
      disclaimerText: disclaimer.text,
      disclaimerLanguage: disclaimer.language,
      disclaimerVersion: disclaimer.version,
      calculationTimestamp: new Date(row.calculated_at).toISOString()
    };
  }
};
var D1MerchantTermsPort = class {
  static {
    __name(this, "D1MerchantTermsPort");
  }
  repo;
  constructor(d1) {
    this.repo = new D1MerchantTermsRepository(d1);
  }
  /** @inheritdoc */
  async getTerms(merchantId) {
    const record = await this.repo.findByMerchant(merchantId);
    if (record === null) return null;
    return {
      merchantId: record.merchantId,
      minimumOrderValueCents: record.minimumOrderValueCents ?? null,
      currency: record.currency,
      reliabilityStatus: toReliabilityStatus(record.reliabilityStatus),
      observedAt: record.observedAt
    };
  }
};
var D1BasketCalculationRecordPort = class {
  static {
    __name(this, "D1BasketCalculationRecordPort");
  }
  repo;
  constructor(d1) {
    this.repo = new D1BasketCalculationRecordRepository(d1);
  }
  /** @inheritdoc */
  async create(record) {
    const persisted = await this.repo.create({
      sessionId: record.sessionId,
      destination: record.destination,
      transportArrangement: record.transportArrangement,
      inputBasket: record.inputBasket,
      shipmentBreakdown: record.shipmentBreakdown,
      totalCents: record.totalCents,
      confidence: record.confidence,
      disclaimer: JSON.stringify(record.disclaimer)
    });
    return { id: persisted.id };
  }
};

// src/adapters/idempotency-facade.ts
init_modules_watch_stub();

// src/do/idempotency.do.ts
init_modules_watch_stub();
var DEFAULT_TTL_SECONDS = 3600;
async function hashCacheKey(input) {
  const parts = [];
  if (input.items !== void 0 && input.items.length > 0) {
    for (const item of input.items) {
      parts.push(String(item.productId), "|", String(item.quantity), "|");
    }
  } else {
    parts.push(String(input.productId), "|", String(input.quantity), "|");
  }
  parts.push(input.destination.toUpperCase(), "|");
  parts.push(input.transportMethod ?? "__NONE__");
  parts.push("|V|");
  if (input.datasetVersions && input.datasetVersions.length > 0) {
    for (const v of [...input.datasetVersions].sort()) {
      parts.push(v, "|");
    }
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join(""))
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashCacheKey, "hashCacheKey");
var JOB_CLAIM_TTL_SECONDS = 25 * 3600;
var JOB_CLAIM_STALE_MS = 15 * 6e4;
var ENTRY_PREFIX = "e:";
var JOB_PREFIX = "job:";
function entryStorageKey(key) {
  return `${ENTRY_PREFIX}${key}`;
}
__name(entryStorageKey, "entryStorageKey");
function jobStorageKey(key) {
  return `${JOB_PREFIX}${key}`;
}
__name(jobStorageKey, "jobStorageKey");
var IdempotencyDO = class {
  constructor(state, _env) {
    this.state = state;
  }
  state;
  static {
    __name(this, "IdempotencyDO");
  }
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    try {
      switch (body.op) {
        case "get":
          return Response.json(await this.get(body.input, body.nowMs));
        case "put":
          await this.put(
            body.input,
            body.result,
            body.datasetVersions,
            body.ttlSeconds,
            body.nowMs
          );
          return Response.json({ stored: true });
        case "putIfAbsent":
          return Response.json({
            stored: await this.putIfAbsent(
              body.input,
              body.result,
              body.datasetVersions,
              body.ttlSeconds,
              body.nowMs
            )
          });
        case "invalidateVersions":
          return Response.json({
            deleted: await this.invalidateVersions(body.versions, body.nowMs)
          });
        case "getByKey":
          return Response.json(await this.getByKey(body.key, body.nowMs));
        case "putByKey":
          await this.putByKey(
            body.key,
            body.result,
            body.datasetVersions,
            body.ttlSeconds,
            body.nowMs
          );
          return Response.json({ stored: true });
        case "size":
          return Response.json({ size: await this.size(body.nowMs) });
        case "clear":
          return Response.json({ deleted: await this.clear() });
        case "claimJob":
          return Response.json({
            outcome: await this.claimJob(body.key, body.staleAfterMs, body.nowMs)
          });
        case "completeJob":
          await this.completeJob(body.key, body.ttlSeconds, body.nowMs);
          return Response.json({ completed: true });
        case "releaseJob":
          await this.releaseJob(body.key);
          return Response.json({ released: true });
        default:
          return Response.json({ error: "unknown op" }, { status: 400 });
      }
    } catch (err) {
      if (err instanceof RangeError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }
  /**
   * Active alarm: sweeps expired entries and job markers, then
   * reschedules itself for the next soonest expiry (Redis active-expiry
   * parity; keeps storage bounded). workerd clears the alarm before
   * invoking it, so re-arming here is unconditional.
   */
  async alarm() {
    const nextEntry = await this.sweepExpired(Date.now());
    const nextJob = await this.sweepExpiredJobs(Date.now());
    const next = nextEntry !== null && nextJob !== null ? Math.min(nextEntry, nextJob) : nextEntry ?? nextJob;
    if (next !== null) {
      await this.state.storage.setAlarm(next);
    }
  }
  // -----------------------------------------------------------------------
  // Ops
  // -----------------------------------------------------------------------
  async get(input, nowMs) {
    const now = nowMs ?? Date.now();
    const key = entryStorageKey(await hashCacheKey(input));
    const stored = await this.state.storage.get(key);
    if (stored === void 0) {
      return { found: false };
    }
    if (stored.expiresAt <= now) {
      await this.state.storage.delete(key);
      return { found: false };
    }
    return { found: true, entry: stored };
  }
  async put(input, result, datasetVersions, ttlSeconds, nowMs) {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds);
    const key = entryStorageKey(await hashCacheKey(input));
    const entry = buildEntry(result, datasetVersions, ttl, now);
    await this.state.storage.put(key, entry);
    await this.scheduleSweep(entry.expiresAt);
  }
  /**
   * Store only when the key has no live entry. Atomic by construction:
   * DO input gates serialize requests while storage awaits resolve, so no
   * interleaving writer can slip between the get and the put.
   */
  async putIfAbsent(input, result, datasetVersions, ttlSeconds, nowMs) {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds);
    const key = entryStorageKey(await hashCacheKey(input));
    const existing = await this.state.storage.get(key);
    if (existing !== void 0 && existing.expiresAt > now) {
      return false;
    }
    const entry = buildEntry(result, datasetVersions, ttl, now);
    await this.state.storage.put(key, entry);
    await this.scheduleSweep(entry.expiresAt);
    return true;
  }
  /**
   * Delete every entry whose datasetVersions intersect the given labels —
   * `invalidateOnVersionChange` parity (the in-memory/Redis scans stand in
   * for the version-index sets here; the keyspace is TTL-bounded).
   */
  async invalidateVersions(versions, nowMs) {
    if (versions.length === 0) return 0;
    const now = nowMs ?? Date.now();
    const targets = new Set(versions);
    let deleted = 0;
    for (const [key, entry] of await this.listEntries()) {
      if (entry.expiresAt > now && entry.datasetVersions.some((v) => targets.has(v))) {
        await this.state.storage.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
  /**
   * Raw-key get — the client-supplied-key path of the Nest
   * IdempotencyService.lookup (the key travels verbatim; hashing only
   * namespaces it into storage). Same lazy-TTL semantics as `get`.
   */
  async getByKey(key, nowMs) {
    const now = nowMs ?? Date.now();
    const storageKey = entryStorageKey(await hashRawKey(key));
    const stored = await this.state.storage.get(storageKey);
    if (stored === void 0) {
      return { found: false };
    }
    if (stored.expiresAt <= now) {
      await this.state.storage.delete(storageKey);
      return { found: false };
    }
    return { found: true, entry: stored };
  }
  /** Raw-key put — the cache-store path for verbatim/namespaced keys. */
  async putByKey(key, result, datasetVersions, ttlSeconds, nowMs) {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds);
    const storageKey = entryStorageKey(await hashRawKey(key));
    const entry = buildEntry(result, datasetVersions, ttl, now);
    await this.state.storage.put(storageKey, entry);
    await this.scheduleSweep(entry.expiresAt);
  }
  /** Live (non-expired, without sweeping) entry count. */
  async size(nowMs) {
    const now = nowMs ?? Date.now();
    let count = 0;
    for (const entry of (await this.listEntries()).values()) {
      if (entry.expiresAt > now) count++;
    }
    return count;
  }
  async clear() {
    const entries = await this.listEntries();
    for (const key of entries.keys()) {
      await this.state.storage.delete(key);
    }
    return entries.size;
  }
  // -----------------------------------------------------------------------
  // Job claims (task 4.1 — consumer idempotent skip)
  // -----------------------------------------------------------------------
  /**
   * Atomically claim a background-job dedupe key. DO input gates
   * serialize requests, so no interleaving claimant can slip between the
   * read and the write.
   *
   * Outcomes: `claimed` (caller runs the job), `already-completed` (the
   * key was processed within its TTL — skip), `in-flight` (another
   * delivery is actively running the key — skip). A `processing` claim
   * older than `staleAfterMs` is a dead attempt and is reclaimed.
   */
  async claimJob(key, staleAfterMs, nowMs) {
    const now = nowMs ?? Date.now();
    const staleAfter = staleAfterMs ?? JOB_CLAIM_STALE_MS;
    const storageKey = jobStorageKey(key);
    const stored = await this.state.storage.get(storageKey);
    if (stored !== void 0) {
      const expired = stored.expiresAt !== void 0 && stored.expiresAt <= now;
      if (!expired) {
        if (stored.state === "completed") {
          return { status: "already-completed" };
        }
        if (now - stored.claimedAt <= staleAfter) {
          return { status: "in-flight" };
        }
      } else {
        await this.state.storage.delete(storageKey);
      }
    }
    await this.state.storage.put(storageKey, {
      state: "processing",
      claimedAt: now
    });
    return { status: "claimed" };
  }
  /**
   * Mark a claimed key completed. Only meaningful after a `claimed`
   * outcome; completed markers expire after `ttlSeconds` so hourly keys
   * do not accumulate.
   */
  async completeJob(key, ttlSeconds, nowMs) {
    const now = nowMs ?? Date.now();
    const ttl = assertTtl(ttlSeconds ?? JOB_CLAIM_TTL_SECONDS);
    const storageKey = jobStorageKey(key);
    const stored = await this.state.storage.get(storageKey);
    const claimedAt = stored?.claimedAt ?? now;
    const expiresAt = now + ttl * 1e3;
    const record = {
      state: "completed",
      claimedAt,
      completedAt: now,
      expiresAt
    };
    await this.state.storage.put(storageKey, record);
    await this.scheduleSweep(expiresAt);
  }
  /**
   * Release a claim without marking completion — the job failed and the
   * Queue will redeliver. The next delivery runs the key again
   * (at-least-once completion; a failed run never leaves a marker that
   * would suppress its own retry).
   */
  async releaseJob(key) {
    await this.state.storage.delete(jobStorageKey(key));
  }
  /** Delete expired job markers; returns the next soonest expiry, if any. */
  async sweepExpiredJobs(now) {
    let next = null;
    for (const [key, record] of await this.listJobClaims()) {
      if (record.expiresAt !== void 0 && record.expiresAt <= now) {
        await this.state.storage.delete(key);
      } else if (record.expiresAt !== void 0 && (next === null || record.expiresAt < next)) {
        next = record.expiresAt;
      }
    }
    return next;
  }
  async listJobClaims() {
    const options = { prefix: JOB_PREFIX };
    return this.state.storage.list(options);
  }
  // -----------------------------------------------------------------------
  // Expiry housekeeping
  // -----------------------------------------------------------------------
  /** Delete expired entries; returns the next soonest expiry, if any. */
  async sweepExpired(now) {
    let next = null;
    for (const [key, entry] of await this.listEntries()) {
      if (entry.expiresAt <= now) {
        await this.state.storage.delete(key);
      } else if (next === null || entry.expiresAt < next) {
        next = entry.expiresAt;
      }
    }
    return next;
  }
  /** Point the alarm at `expiresAt` unless an earlier one is set. */
  async scheduleSweep(expiresAt) {
    const current = await this.state.storage.getAlarm();
    if (current === null || expiresAt < current) {
      await this.state.storage.setAlarm(expiresAt);
    }
  }
  async listEntries() {
    const options = { prefix: ENTRY_PREFIX };
    return this.state.storage.list(options);
  }
};
function buildEntry(result, datasetVersions, ttlSeconds, now) {
  const versions = datasetVersions ?? readResultVersions(result) ?? [];
  return {
    result,
    datasetVersions: versions,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + ttlSeconds * 1e3
  };
}
__name(buildEntry, "buildEntry");
function readResultVersions(result) {
  if (typeof result === "object" && result !== null && "metadata" in result && typeof result.metadata === "object" && result.metadata !== null) {
    const versions = result.metadata.datasetVersions;
    if (Array.isArray(versions)) {
      return versions.filter((v) => typeof v === "string");
    }
  }
  return void 0;
}
__name(readResultVersions, "readResultVersions");
function assertTtl(ttlSeconds) {
  const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl < 1) {
    throw new RangeError("ttlSeconds must be a finite number >= 1");
  }
  return ttl;
}
__name(assertTtl, "assertTtl");
async function hashRawKey(key) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`raw-key:${key}`)
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashRawKey, "hashRawKey");

// src/adapters/idempotency-facade.ts
async function sha256Hex2(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex2, "sha256Hex");
var idempotencyCacheKey = hashCacheKey;
function versionsMatch(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}
__name(versionsMatch, "versionsMatch");
async function idempotencyLookup(env, key, currentVersions) {
  const entry = await idempotencyGetByKey(env, key);
  if (entry === null) return null;
  if (currentVersions !== void 0 && currentVersions.length > 0 && !versionsMatch(entry.datasetVersions, currentVersions)) {
    return null;
  }
  return entry;
}
__name(idempotencyLookup, "idempotencyLookup");
function idempotencyStore(env, key, result, options) {
  return idempotencyPutByKey(env, key, result, options);
}
__name(idempotencyStore, "idempotencyStore");
function idempotencyContentHash(result) {
  return sha256Hex2(JSON.stringify(result));
}
__name(idempotencyContentHash, "idempotencyContentHash");

// ../../packages/data-platform/src/repositories/d1/tax-rate.repository.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/effective-range-validator.ts
init_modules_watch_stub();
function validateEffectiveRanges(rules) {
  if (rules.length < 2) return [];
  const sorted = [...rules].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
  );
  const errors = [];
  const openEnded = sorted.filter((r) => r.effectiveTo === null);
  if (openEnded.length > 1) {
    errors.push(
      `Multiple open-ended rules: ${openEnded.map((r) => r.effectiveFrom.toISOString()).join(", ")}`
    );
    return errors;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    if (prev.effectiveTo === null) {
      errors.push(
        `Overlap: open-ended rule starting ${prev.effectiveFrom.toISOString()} overlaps with rule starting ${next.effectiveFrom.toISOString()}`
      );
      continue;
    }
    if (next.effectiveFrom.getTime() <= prev.effectiveTo.getTime()) {
      errors.push(
        `Overlap: rule [${prev.effectiveFrom.toISOString()} \u2013 ${prev.effectiveTo.toISOString()}] overlaps with rule starting ${next.effectiveFrom.toISOString()}`
      );
      continue;
    }
    const dayAfterEnd = new Date(prev.effectiveTo);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    if (next.effectiveFrom.getTime() > dayAfterEnd.getTime()) {
      errors.push(
        `Gap: rule ending ${prev.effectiveTo.toISOString()} followed by rule starting ${next.effectiveFrom.toISOString()} (expected start ${dayAfterEnd.toISOString()})`
      );
    }
  }
  return errors;
}
__name(validateEffectiveRanges, "validateEffectiveRanges");

// ../../packages/data-platform/src/repositories/d1/tax-rate.repository.ts
var RATE_SCALE = 6;
function parseJsonColumn(value) {
  return value === null ? null : JSON.parse(value);
}
__name(parseJsonColumn, "parseJsonColumn");
function toInstant(value) {
  return new Date(value);
}
__name(toInstant, "toInstant");
function toContractTaxRule(row) {
  return {
    id: row.id,
    taxType: row.tax_type,
    productCategory: row.product_category,
    rate: row.rate.toFixed(RATE_SCALE),
    effectiveFrom: toInstant(row.effective_from),
    effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to),
    exemptionConditions: parseJsonColumn(row.exemption_conditions),
    calculationFormulaReference: row.calculation_formula_reference,
    officialSource: row.official_source,
    verificationDate: row.verification_date === null ? null : toInstant(row.verification_date),
    versionLabel: row.version_label,
    createdAt: toInstant(row.created_at)
  };
}
__name(toContractTaxRule, "toContractTaxRule");
var TAX_RULE_COLUMNS = `
  id, tax_type, product_category, rate, effective_from, effective_to,
  exemption_conditions, calculation_formula_reference, official_source,
  verification_date, version_label, created_at`;
var FIND_EFFECTIVE_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC
   LIMIT 1`;
var FIND_BY_ID_SQL3 = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules WHERE id = ?`;
var FIND_HISTORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from ASC`;
var RANGE_VALIDATION_SQL = `
  SELECT effective_from, effective_to, exemption_conditions FROM tax_rules
   WHERE tax_type = ? AND product_category = ?`;
var D1TaxRateRepository = class extends TaxRateRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async findEffectiveVersion(asOf) {
    const asOfText = asOf.toISOString();
    const row = await this.d1.prepare(FIND_EFFECTIVE_SQL).bind(asOfText, asOfText).first();
    return row ? toContractTaxRule(row) : null;
  }
  /** @inheritdoc */
  async findVersionById(id) {
    const row = await this.d1.prepare(FIND_BY_ID_SQL3).bind(id).first();
    return row ? toContractTaxRule(row) : null;
  }
  /** @inheritdoc */
  async findHistoryRates(taxType, productCategory, fromDate, toDate) {
    const rows = (await this.d1.prepare(FIND_HISTORY_SQL).bind(taxType, productCategory, toDate.toISOString(), fromDate.toISOString()).all()).results;
    return rows.map(toContractTaxRule);
  }
  /**
   * Validate that effective-date ranges for a given (taxType, productCategory)
   * are non-overlapping and gapless, including optional candidate rows that
   * have not yet been persisted — same contract as the pg repository, using
   * the shared pure validator. A category carries one CONCURRENT timeline
   * per ABV band; ranges are contiguous within a band, not across bands.
   *
   * @throws {Error} with a descriptive message if gaps or overlaps are found.
   */
  async validateEffectiveRanges(taxType, productCategory, candidates) {
    const rows = (await this.d1.prepare(RANGE_VALIDATION_SQL).bind(taxType, productCategory).all()).results;
    const byBand = /* @__PURE__ */ new Map();
    const bandKey = /* @__PURE__ */ __name((band) => band == null ? "none" : JSON.stringify(band), "bandKey");
    for (const row of rows) {
      const band = parseJsonColumn(row.exemption_conditions);
      const key = bandKey(band);
      if (!byBand.has(key)) byBand.set(key, []);
      byBand.get(key).push({
        effectiveFrom: toInstant(row.effective_from),
        effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to)
      });
    }
    if (candidates) {
      byBand.set("__candidates__", candidates);
    }
    const errors = [];
    for (const [key, bandRows] of byBand) {
      for (const err of validateEffectiveRanges(bandRows)) {
        errors.push(`[${taxType}:${productCategory} band=${key}] ${err}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Invalid effective ranges for taxType="${taxType}" productCategory="${productCategory}": ${errors.join("; ")}`
      );
    }
  }
};
__name(D1TaxRateRepository, "D1TaxRateRepository");
D1TaxRateRepository = __decorateClass([
  Injectable()
], D1TaxRateRepository);
var FIND_BY_CATEGORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC
   LIMIT 1`;
var FIND_ALL_BY_CATEGORY_SQL = `
  SELECT ${TAX_RULE_COLUMNS} FROM tax_rules
   WHERE tax_type = ? AND product_category = ?
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY effective_from DESC`;
var ACTIVE_VERSION_LABELS_SQL = `
  SELECT DISTINCT version_label FROM tax_rules
   WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
   ORDER BY version_label ASC`;
var D1TaxRuleRepositoryAdapter = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async findApplicable(taxType, productCategory, asOf) {
    const exact = await this.findByCategory(taxType, productCategory, asOf);
    if (exact) {
      return this.toPortRecord(exact);
    }
    const general = await this.findByCategory(taxType, "general", asOf);
    if (general) {
      return this.toPortRecord(general);
    }
    return null;
  }
  /** @inheritdoc */
  async findAllApplicable(taxType, productCategory, asOf) {
    const rows = (await this.d1.prepare(FIND_ALL_BY_CATEGORY_SQL).bind(taxType, productCategory, asOf.toISOString(), asOf.toISOString()).all()).results;
    return rows.map((row) => this.toPortRecord(row));
  }
  /** @inheritdoc */
  async findHistoryRates(taxType, productCategory, fromDate, toDate) {
    const rows = (await this.d1.prepare(FIND_HISTORY_SQL).bind(taxType, productCategory, toDate.toISOString(), fromDate.toISOString()).all()).results;
    return rows.map((row) => this.toPortRecord(row));
  }
  /** @inheritdoc */
  async findActiveVersionLabels() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rows = (await this.d1.prepare(ACTIVE_VERSION_LABELS_SQL).bind(now, now).all()).results;
    return rows.map((r) => r.version_label);
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  /** Most recent active rule for the given type and category, or null. */
  async findByCategory(taxType, productCategory, asOf) {
    return this.d1.prepare(FIND_BY_CATEGORY_SQL).bind(taxType, productCategory, asOf.toISOString(), asOf.toISOString()).first();
  }
  /**
   * Raw row → the port read model. The decimal-text rate passes through
   * (the port carries decimal strings by design); the JSONB-shaped
   * exemption conditions flatten to their ABV tier — the same mapping
   * the pg adapter performs on the driver's parsed jsonb.
   */
  toPortRecord(row) {
    const raw2 = parseJsonColumn(row.exemption_conditions);
    let exemptionConditions = null;
    if (raw2 && typeof raw2.appliesTo === "object" && raw2.appliesTo !== null) {
      const appliesTo = raw2.appliesTo;
      const min = typeof appliesTo.minAlcoholByVolume === "number" ? appliesTo.minAlcoholByVolume : void 0;
      const max = typeof appliesTo.maxAlcoholByVolume === "number" ? appliesTo.maxAlcoholByVolume : void 0;
      if (min !== void 0 || max !== void 0) {
        exemptionConditions = { minAlcoholByVolume: min, maxAlcoholByVolume: max };
      }
    }
    return {
      id: row.id,
      taxType: row.tax_type,
      productCategory: row.product_category,
      rate: row.rate.toFixed(RATE_SCALE),
      effectiveFrom: toInstant(row.effective_from),
      effectiveTo: row.effective_to === null ? null : toInstant(row.effective_to),
      calculationFormulaReference: row.calculation_formula_reference,
      officialSource: row.official_source,
      verificationDate: row.verification_date === null ? null : toInstant(row.verification_date),
      versionLabel: row.version_label,
      exemptionConditions
    };
  }
};
__name(D1TaxRuleRepositoryAdapter, "D1TaxRuleRepositoryAdapter");
D1TaxRuleRepositoryAdapter = __decorateClass([
  Injectable()
], D1TaxRuleRepositoryAdapter);

// ../../packages/data-platform/src/repositories/d1/product-search.repository.ts
init_modules_watch_stub();
var PRODUCT_COLUMNS = `
  id, name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
  container_type, regulatory_classification, deposit_system_status, ean,
  created_at, updated_at`;
var BM25_COLUMN_WEIGHTS = "bm25(`product_master_fts`, 10.0, 5.0, 2.0)";
function tokenize(query) {
  return query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}
__name(tokenize, "tokenize");
function buildMatchExpression(tokens) {
  const phrase = tokens.map((t) => t.replace(/"/g, '""')).join('" "');
  return `"${phrase}" *`;
}
__name(buildMatchExpression, "buildMatchExpression");
function likePattern(query) {
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}
__name(likePattern, "likePattern");
var ALCOHOL_BY_VOLUME_SCALE = 3;
var UNIT_VOLUME_SCALE = 4;
function realToNumericText(value, scale) {
  return value === null ? null : value.toFixed(scale);
}
__name(realToNumericText, "realToNumericText");
function numericTextToReal(value) {
  if (value === void 0) return void 0;
  if (value === null) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid decimal value: ${JSON.stringify(value)}`);
  }
  return parsed;
}
__name(numericTextToReal, "numericTextToReal");
function intToBoolean(value) {
  return value === null ? null : value !== 0;
}
__name(intToBoolean, "intToBoolean");
function booleanToInt(value) {
  return value == null ? null : value ? 1 : 0;
}
__name(booleanToInt, "booleanToInt");
function toContractProduct(row) {
  const unitVolume = realToNumericText(row.unit_volume, UNIT_VOLUME_SCALE);
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    brand: row.brand,
    category: row.category,
    alcoholByVolume: realToNumericText(row.alcohol_by_volume, ALCOHOL_BY_VOLUME_SCALE),
    unitVolume,
    containerType: row.container_type,
    regulatoryClassification: row.regulatory_classification,
    depositSystemStatus: intToBoolean(row.deposit_system_status),
    ean: row.ean,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
__name(toContractProduct, "toContractProduct");
function toContractOffer(row) {
  return {
    id: row.id,
    merchant: row.merchant,
    country: row.country,
    productId: row.product_id,
    priceCents: row.price_cents,
    currency: row.currency,
    originalPriceCents: row.original_price_cents,
    originalCurrency: row.original_currency,
    fxDatasetVersion: row.fx_dataset_version,
    availability: row.availability,
    sourceUrl: row.source_url,
    observedAt: new Date(row.observed_at),
    reliabilityStatus: row.reliability_status
  };
}
__name(toContractOffer, "toContractOffer");
function insertParams(record) {
  const unitVolume = numericTextToReal(record.unitVolume);
  if (unitVolume == null) {
    throw new TypeError("unitVolume is required");
  }
  return [
    record.name,
    record.manufacturer,
    record.brand,
    record.category,
    numericTextToReal(record.alcoholByVolume) ?? null,
    unitVolume,
    record.containerType,
    record.regulatoryClassification,
    booleanToInt(record.depositSystemStatus),
    record.ean ?? null,
    record.createdAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString(),
    record.updatedAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString()
  ];
}
__name(insertParams, "insertParams");
var FTS_SEARCH_SQL = `
  SELECT p.id, p.name, p.manufacturer, p.brand, p.category,
         p.alcohol_by_volume, p.unit_volume, p.container_type,
         p.regulatory_classification, p.deposit_system_status, p.ean,
         p.created_at, p.updated_at
    FROM product_master_fts f
    JOIN product_master p ON p.id = f.rowid
   WHERE product_master_fts MATCH ?
   ORDER BY ${BM25_COLUMN_WEIGHTS} ASC, p.id ASC
   LIMIT ?`;
var RANKED_LIKE_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE name LIKE ? ESCAPE '\\'
      OR brand LIKE ? ESCAPE '\\'
      OR manufacturer LIKE ? ESCAPE '\\'
   ORDER BY id ASC
   LIMIT ?`;
var NAME_LIKE_SQL = `
  SELECT ${PRODUCT_COLUMNS}
    FROM product_master
   WHERE name LIKE ? ESCAPE '\\'
   ORDER BY id ASC`;
var INSERT_SQL3 = `
  INSERT INTO product_master (
    name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${PRODUCT_COLUMNS}`;
var INSERT_WITH_ID_SQL = `
  INSERT INTO product_master (
    id, name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING ${PRODUCT_COLUMNS}`;
var UPDATE_BY_EAN_SQL = `
  UPDATE product_master SET
    name = ?, manufacturer = ?, brand = ?, category = ?, alcohol_by_volume = ?,
    unit_volume = ?, container_type = ?, regulatory_classification = ?,
    deposit_system_status = ?, updated_at = ?
  WHERE ean = ?
  RETURNING ${PRODUCT_COLUMNS}`;
var D1ProductSearchRepository = class extends ProductRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /**
   * Substring listing over product names, or the unfiltered alphabetical
   * listing when the query is null/blank — the pg contract. The LIKE
   * pre-filter narrows in SQL; Unicode case folding and the Finnish
   * collation are applied app-side (D1 has no custom collations).
   */
  async searchByName(query, limit) {
    if (query === null || query.trim().length === 0) {
      return this.listAlphabetical(limit);
    }
    const trimmed = query.trim();
    const rows = (await this.d1.prepare(NAME_LIKE_SQL).bind(likePattern(trimmed)).all()).results;
    const needle = trimmed.toLowerCase();
    const matched = rows.filter(
      (row) => row.name.toLowerCase().includes(needle)
    );
    return sortAlphabetical(matched).slice(0, limit).map(toContractProduct);
  }
  /**
   * Ranked search over name, brand, and manufacturer — FTS5 MATCH with
   * prefix expansion first, LIKE '%q%' fallback/merge second,
   * deterministic tie-break ordering. Mirrors `searchRanked(query, limit)`
   * of the pg repository; blank/whitespace queries fall through to the
   * unfiltered alphabetical listing (defensive total-order parity with
   * the spike, which never throws on whitespace).
   */
  async searchRanked(query, limit) {
    const trimmed = query.trim();
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) {
      return this.listAlphabetical(limit);
    }
    const ftsRows = (await this.d1.prepare(FTS_SEARCH_SQL).bind(buildMatchExpression(tokens), limit).all()).results;
    const pattern = likePattern(trimmed);
    const likeRows = (await this.d1.prepare(RANKED_LIKE_SQL).bind(pattern, pattern, pattern, limit).all()).results;
    const seen = /* @__PURE__ */ new Set();
    const merged = [];
    for (const row of [...ftsRows, ...likeRows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    return merged.map(toContractProduct);
  }
  /** @inheritdoc */
  async findById(id) {
    const row = await this.d1.prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_master WHERE id = ?`).bind(id).first();
    return row ? toContractProduct(row) : null;
  }
  /** @inheritdoc */
  async findOffers(productId) {
    const rows = (await this.d1.prepare(
      `SELECT id, merchant, country, product_id, price_cents, currency,
                  original_price_cents, original_currency, fx_dataset_version,
                  availability, source_url, observed_at, reliability_status
             FROM retail_offers
            WHERE product_id = ?
            ORDER BY id ASC`
    ).bind(productId).all()).results;
    return rows.map(toContractOffer);
  }
  /** @inheritdoc */
  async findRetailOfferById(id) {
    const row = await this.d1.prepare(
      `SELECT id, merchant, country, product_id, price_cents, currency,
                original_price_cents, original_currency, fx_dataset_version,
                availability, source_url, observed_at, reliability_status
           FROM retail_offers WHERE id = ?`
    ).bind(id).first();
    return row ? toContractOffer(row) : null;
  }
  /** @inheritdoc */
  async create(record) {
    const row = record.id === void 0 ? await this.d1.prepare(INSERT_SQL3).bind(...insertParams(record)).first() : await this.d1.prepare(INSERT_WITH_ID_SQL).bind(record.id, ...insertParams(record)).first();
    if (!row) {
      throw new Error("product_master INSERT .. RETURNING returned no row");
    }
    return toContractProduct(row);
  }
  /** @inheritdoc */
  async upsertByEan(record) {
    if (!record.ean) {
      return this.create(record);
    }
    const existing = await this.d1.prepare("SELECT id FROM product_master WHERE ean = ?").bind(record.ean).first();
    if (existing) {
      const row = await this.d1.prepare(UPDATE_BY_EAN_SQL).bind(
        record.name,
        record.manufacturer,
        record.brand,
        record.category,
        numericTextToReal(record.alcoholByVolume) ?? null,
        numericTextToReal(record.unitVolume),
        record.containerType,
        record.regulatoryClassification,
        booleanToInt(record.depositSystemStatus),
        record.updatedAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString(),
        record.ean
      ).first();
      if (!row) {
        throw new Error("product_master UPDATE .. RETURNING returned no row");
      }
      return toContractProduct(row);
    }
    return this.create(record);
  }
  /**
   * Unfiltered alphabetical listing — the repository `searchByName(null)`
   * path. Fetch + JS `localeCompare(…, 'fi')` mirrors the
   * SearchController compareByName contract; SQLite/D1 cannot provide the
   * Finnish collation server-side, so the ordering must stay in
   * application code. The product set is small (~10⁴ rows, design D3),
   * making the fetch-then-sort-then-limit shape safe.
   */
  async listAlphabetical(limit) {
    const rows = (await this.d1.prepare(`SELECT ${PRODUCT_COLUMNS} FROM product_master`).all()).results;
    return sortAlphabetical(rows).slice(0, limit).map(toContractProduct);
  }
};
__name(D1ProductSearchRepository, "D1ProductSearchRepository");
D1ProductSearchRepository = __decorateClass([
  Injectable()
], D1ProductSearchRepository);
function sortAlphabetical(rows) {
  return [...rows].sort(
    (a, b) => a.name.localeCompare(b.name, "fi") || a.id - b.id
  );
}
__name(sortAlphabetical, "sortAlphabetical");

// ../../packages/data-platform/src/repositories/d1/transport-offer.repository.ts
init_modules_watch_stub();
var WEIGHT_SCALE = 4;
function toContractOffer2(row) {
  return {
    id: row.id,
    carrier: row.carrier,
    originCountry: row.origin_country,
    destinationCountry: row.destination_country,
    weightMinKg: row.weight_min_kg === null ? null : row.weight_min_kg.toFixed(WEIGHT_SCALE),
    weightMaxKg: row.weight_max_kg === null ? null : row.weight_max_kg.toFixed(WEIGHT_SCALE),
    packageTier: row.package_tier,
    priceCents: row.price_cents,
    currency: row.currency,
    sellerInvolvementIndicator: row.seller_involvement_indicator !== 0,
    observedAt: new Date(row.observed_at),
    refreshedAt: new Date(row.refreshed_at),
    reliabilityStatus: row.reliability_status
  };
}
__name(toContractOffer2, "toContractOffer");
var OFFER_COLUMNS = `
  id, carrier, origin_country, destination_country, weight_min_kg,
  weight_max_kg, package_tier, price_cents, currency,
  seller_involvement_indicator, observed_at, refreshed_at,
  reliability_status`;
var FIND_BY_CARRIER_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers WHERE carrier = ?`;
var FIND_RECENT_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers WHERE observed_at >= ?`;
var FIND_ALL_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers`;
var FIND_APPLICABLE_SQL = `
  SELECT ${OFFER_COLUMNS} FROM transport_offers
   WHERE carrier = ? AND origin_country = ? AND destination_country = ?
     AND package_tier = ?
     AND (weight_min_kg IS NULL OR weight_min_kg <= ?)
     AND (weight_max_kg IS NULL OR weight_max_kg > ?)`;
var D1TransportOfferRepository = class extends TransportOfferRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async findByCarrier(carrierId) {
    const rows = (await this.d1.prepare(FIND_BY_CARRIER_SQL).bind(carrierId).all()).results;
    return rows.map(toContractOffer2);
  }
  /**
   * Offers observed within the last seven days, falling back to the
   * whole table when no row is that fresh — the pg staleness fallback,
   * preserved verbatim.
   */
  async findActive() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3);
    const recent = (await this.d1.prepare(FIND_RECENT_SQL).bind(sevenDaysAgo.toISOString()).all()).results;
    if (recent.length > 0) {
      return recent.map(toContractOffer2);
    }
    const all = (await this.d1.prepare(FIND_ALL_SQL).all()).results;
    return all.map(toContractOffer2);
  }
  /** @inheritdoc */
  async findApplicable(carrier, origin, destination, weightKg, packageType) {
    const rows = (await this.d1.prepare(FIND_APPLICABLE_SQL).bind(carrier, origin, destination, packageType, weightKg, weightKg).all()).results;
    return rows.map(toContractOffer2);
  }
};
__name(D1TransportOfferRepository, "D1TransportOfferRepository");
D1TransportOfferRepository = __decorateClass([
  Injectable()
], D1TransportOfferRepository);

// ../../packages/application-api/src/calculator/calculation-result.mapper.ts
init_modules_watch_stub();
var RELIABILITY_STATUSES = [
  "VERIFIED",
  "ESTIMATED",
  "STALE",
  "UNAVAILABLE"
];
var COST_CATEGORIES = [
  "foreignRetailPrice",
  "transportCost",
  "alcoholExciseEstimate",
  "containerDutyEstimate"
];
var CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"];
function isReliabilityStatus(value) {
  return typeof value === "string" && RELIABILITY_STATUSES.includes(value);
}
__name(isReliabilityStatus, "isReliabilityStatus");
function isCostCategory(value) {
  return typeof value === "string" && COST_CATEGORIES.includes(value);
}
__name(isCostCategory, "isCostCategory");
function toConfidenceLevel(value) {
  return CONFIDENCE_LEVELS.includes(value) ? value : "LOW";
}
__name(toConfidenceLevel, "toConfidenceLevel");
function parseNumeric2(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}
__name(parseNumeric2, "parseNumeric");
function toItemizedCost(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return null;
  const entry = raw2;
  if (!isCostCategory(entry.category)) return null;
  const reliability = isReliabilityStatus(entry.reliability) ? entry.reliability : "UNAVAILABLE";
  const cents = typeof entry.cents === "number" && Number.isFinite(entry.cents) ? entry.cents : 0;
  const nested = Array.isArray(entry.breakdown) ? entry.breakdown.map(toItemizedCost).filter((c) => c !== null) : void 0;
  return {
    label: typeof entry.label === "string" ? entry.label : "",
    category: entry.category,
    cents,
    reliability,
    ...nested !== void 0 && nested.length > 0 ? { breakdown: nested } : {}
  };
}
__name(toItemizedCost, "toItemizedCost");
function parseItemizedCosts(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map(toItemizedCost).filter((c) => c !== null);
}
__name(parseItemizedCosts, "parseItemizedCosts");
function parseRetailOfferIds(raw2) {
  if (!Array.isArray(raw2)) return [];
  return raw2.filter((id) => typeof id === "number");
}
__name(parseRetailOfferIds, "parseRetailOfferIds");
function parseDisclaimer2(raw2) {
  try {
    const parsed = JSON.parse(raw2);
    if (typeof parsed.text === "string" && (parsed.language === "fi" || parsed.language === "en") && typeof parsed.version === "string") {
      return {
        text: parsed.text,
        language: parsed.language,
        version: parsed.version
      };
    }
  } catch {
  }
  return { text: raw2, language: "fi", version: "unknown" };
}
__name(parseDisclaimer2, "parseDisclaimer");
function sumCategory(itemizedCosts, category) {
  return itemizedCosts.filter((c) => c.category === category).reduce((sum, c) => sum + c.cents, 0);
}
__name(sumCategory, "sumCategory");
function mapCalculationRecordToResult(input) {
  const { record, product } = input;
  const itemizedCosts = parseItemizedCosts(record.breakdown);
  const datasetVersions = [];
  if (input.exciseVersionLabel !== null) {
    datasetVersions.push(input.exciseVersionLabel);
  }
  if (input.containerVersionLabel !== null && !datasetVersions.includes(input.containerVersionLabel)) {
    datasetVersions.push(input.containerVersionLabel);
  }
  return {
    itemizedCosts,
    foreignRetailPrice: sumCategory(itemizedCosts, "foreignRetailPrice"),
    transportCost: sumCategory(itemizedCosts, "transportCost"),
    alcoholExciseEstimate: sumCategory(itemizedCosts, "alcoholExciseEstimate"),
    containerDutyEstimate: sumCategory(itemizedCosts, "containerDutyEstimate"),
    // Offer exclusions are computed on the live path (task 1.5) but not
    // persisted with the record — the reconstructed result reports none.
    // Empty is the representable "nothing to surface" state; the result
    // page hides the section, the same degradation as confidenceBreakdown.
    excludedOffers: [],
    // The selected offer's pre-conversion price is likewise live-only;
    // absence renders as EUR-native (optional in the frontend contract).
    totalCents: record.totalCents,
    currency: "EUR",
    confidence: toConfidenceLevel(record.confidence),
    // Not persisted per data point — absence is a real state; the page
    // hides the section when the array is empty.
    confidenceBreakdown: [],
    disclaimer: parseDisclaimer2(record.disclaimer),
    // Not persisted — derive nothing; factual marker + explanation.
    classification: {
      classification: "NotPersisted",
      confidence: "LOW",
      evidence: [],
      evidenceSummary: "Transaction classification is not persisted with the calculation record and cannot be shown for a past result."
    },
    metadata: {
      input: {
        // CalculatorInput.productId IS the product-master ID (see
        // LandedCostCalculatorService.resolveProduct).
        productId: record.productMasterId,
        quantity: record.quantity,
        destination: record.destination,
        // transportMethod is not persisted — omitted (optional in the
        // frontend contract; the page renders 'Default').
        ...record.sessionId !== null ? { sessionId: record.sessionId } : {}
      },
      calculationTimestamp: new Date(record.calculatedAt).toISOString(),
      productMasterId: record.productMasterId,
      retailOfferIds: parseRetailOfferIds(record.retailOfferIds),
      quantity: record.quantity,
      destination: record.destination,
      productName: product?.name ?? `Unknown product (ID ${record.productMasterId})`,
      volumeLitres: product ? parseNumeric2(product.unitVolume) : 0,
      alcoholByVolume: product?.alcoholByVolume !== null && product?.alcoholByVolume !== void 0 ? parseNumeric2(product.alcoholByVolume) : 0,
      category: product?.category ?? "unknown",
      datasetVersions,
      transportOfferId: record.transportOfferId
    },
    calculationRecordId: record.id
  };
}
__name(mapCalculationRecordToResult, "mapCalculationRecordToResult");

// src/routes/calculator.routes.ts
function buildLandedCostCalculatorService(d1) {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  const calculator = new LandedCostCalculatorService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRepo),
    new ContainerDutyService(taxRepo),
    new TransactionClassificationService(new TransportClassificationService()),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1))
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1CalculationRecordPort(d1)
  );
  return { calculator, taxRepo };
}
__name(buildLandedCostCalculatorService, "buildLandedCostCalculatorService");
var calculateRequestSchema = external_exports.object({
  productId: external_exports.number({
    required_error: "productId must be a positive integer",
    invalid_type_error: "productId must be a positive integer"
  }).int("productId must be a positive integer").positive("productId must be a positive integer"),
  quantity: external_exports.number({
    required_error: "quantity must be a positive integer",
    invalid_type_error: "quantity must be a positive integer"
  }).int("quantity must be a positive integer").positive("quantity must be a positive integer"),
  destination: external_exports.string({
    required_error: "destination must be a 2-letter ISO 3166-1 alpha-2 country code",
    invalid_type_error: "destination must be a 2-letter ISO 3166-1 alpha-2 country code"
  }).length(
    2,
    "destination must be a 2-letter ISO 3166-1 alpha-2 country code"
  ),
  transportMethod: external_exports.string({ invalid_type_error: "transportMethod must be a string when provided" }).optional(),
  transportArrangement: external_exports.enum(["SELLER_ARRANGED", "INDEPENDENT_CARRIER", "PERSONAL"], {
    invalid_type_error: "transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL"
  }).optional(),
  sessionId: external_exports.string({ invalid_type_error: "sessionId must be a string when provided" }).optional()
});
async function calculate(c) {
  const dto = await parseDto(c, calculateRequestSchema);
  const idempotencyKey = c.req.header("x-idempotency-key");
  const input = {
    productId: dto.productId,
    quantity: dto.quantity,
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    transportArrangement: dto.transportArrangement,
    sessionId: dto.sessionId
  };
  const { calculator, taxRepo } = buildLandedCostCalculatorService(c.env.DB);
  const currentVersions = await taxRepo.findActiveVersionLabels();
  const cacheKey = idempotencyKey ?? await idempotencyCacheKey({ ...input, datasetVersions: currentVersions });
  const cached = await idempotencyLookup(c.env, cacheKey, currentVersions);
  if (cached !== null) {
    c.header("X-Cache", "HIT");
    c.header("X-Content-Hash", await idempotencyContentHash(cached.result));
    return c.json(cached.result);
  }
  try {
    const result = await calculator.calculate(input);
    await idempotencyStore(c.env, cacheKey, result);
    c.header("X-Cache", "MISS");
    c.header("X-Content-Hash", await idempotencyContentHash(result));
    return c.json(result);
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof NoRetailOffersError) {
      throw new ApiHttpError(404, err.message);
    }
    if (err instanceof ClassificationGateRejectionError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: "ClassificationGateRejection",
        productId: err.productId,
        reason: err.reason
      });
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Unexpected calculation error"
    );
  }
}
__name(calculate, "calculate");
async function getResult(c) {
  const recordId = parseIntParam(c, "recordId");
  const d1 = c.env.DB;
  const record = await new D1CalculationRecordRepository(d1).findById(recordId);
  if (record === null) {
    throw new ApiHttpError(404, `Calculation record ${recordId} not found`);
  }
  const taxRepo = new D1TaxRateRepository(d1);
  const [product, exciseRule, containerRule] = await Promise.all([
    new D1ProductSearchRepository(d1).findById(record.productMasterId),
    record.exciseRuleVersionId !== null ? taxRepo.findVersionById(record.exciseRuleVersionId) : Promise.resolve(null),
    record.containerDutyRuleVersionId !== null ? taxRepo.findVersionById(record.containerDutyRuleVersionId) : Promise.resolve(null)
  ]);
  return c.json(
    mapCalculationRecordToResult({
      record,
      product,
      exciseVersionLabel: exciseRule?.versionLabel ?? null,
      containerVersionLabel: containerRule?.versionLabel ?? null
    })
  );
}
__name(getResult, "getResult");
var EXCISE_CATEGORIES = ["beer", "wine", "spirits", "intermediate", "other"];
var CONTAINER_TYPES = ["glass", "plastic", "metal", "carton", "other"];
var TRANSACTION_CLASSES = ["distance-selling", "distance-buying", "traveller-import"];
var exciseBaseSchema = external_exports.object({
  category: external_exports.enum(EXCISE_CATEGORIES, {
    errorMap: /* @__PURE__ */ __name(() => ({
      message: `category must be one of: ${EXCISE_CATEGORIES.join(", ")}`
    }), "errorMap")
  }),
  volumeLitres: external_exports.number({
    required_error: "volumeLitres must be a positive number",
    invalid_type_error: "volumeLitres must be a positive number"
  }).positive("volumeLitres must be a positive number"),
  alcoholByVolume: external_exports.number({
    required_error: "alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)",
    invalid_type_error: "alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)"
  }).min(
    0,
    "alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)"
  ).max(
    1,
    "alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)"
  )
});
var landedCostSchema = external_exports.object({
  retailPriceCents: external_exports.number({
    required_error: "retailPriceCents must be a non-negative integer",
    invalid_type_error: "retailPriceCents must be a non-negative integer"
  }).int("retailPriceCents must be a non-negative integer").min(0, "retailPriceCents must be a non-negative integer"),
  transportCostCents: external_exports.number({
    required_error: "transportCostCents must be a non-negative integer",
    invalid_type_error: "transportCostCents must be a non-negative integer"
  }).int("transportCostCents must be a non-negative integer").min(0, "transportCostCents must be a non-negative integer"),
  // The controller does not field-check exciseBase in
  // validateLandedCostRequest — its internals only surface through the
  // 'exciseBase: '-prefixed nested message (validateLandedCost below).
  exciseBase: external_exports.unknown().optional(),
  containerType: external_exports.enum(CONTAINER_TYPES, {
    errorMap: /* @__PURE__ */ __name(() => ({
      message: `containerType must be one of: ${CONTAINER_TYPES.join(", ")}, or null`
    }), "errorMap")
  }).nullable(),
  containerVolumeLitres: external_exports.number({
    invalid_type_error: "containerVolumeLitres must be a positive number when containerType is present"
  }).positive(
    "containerVolumeLitres must be a positive number when containerType is present"
  ).nullable().optional(),
  depositSystemVerified: external_exports.boolean({
    invalid_type_error: "depositSystemVerified must be a boolean"
  }).nullable().optional(),
  transactionClass: external_exports.enum(TRANSACTION_CLASSES, {
    errorMap: /* @__PURE__ */ __name(() => ({
      message: `transactionClass must be one of: ${TRANSACTION_CLASSES.join(", ")}`
    }), "errorMap")
  })
});
function mapExciseResult(base, result) {
  return {
    exciseAmountCents: result.taxCents,
    category: base.category,
    rateVersionId: result.taxDatasetVersion,
    calculatedAt: /* @__PURE__ */ new Date(),
    evidence: {
      volumeLitres: result.volumeLitres,
      alcoholByVolume: result.abv,
      rateAppliedCentsPerUnit: Math.round(result.rateApplied * 100)
    }
  };
}
__name(mapExciseResult, "mapExciseResult");
function mapContainerDutyResult(containerType, result) {
  return {
    dutyAmountCents: result.dutyCents,
    reliability: result.reliability === "VERIFIED" ? "EXACT" : "ESTIMATED",
    evidence: {
      containerType,
      volumeLitres: result.volumeLitres,
      rateAppliedCentsPerLitre: Math.round(result.ratePerLitre * 100),
      depositExemptionApplied: result.depositExemption?.exempted ?? false
    }
  };
}
__name(mapContainerDutyResult, "mapContainerDutyResult");
function validateLandedCost(dto) {
  const errors = [];
  if (dto.containerType !== null) {
    if (typeof dto.containerVolumeLitres !== "number" || !Number.isFinite(dto.containerVolumeLitres) || dto.containerVolumeLitres <= 0) {
      errors.push(
        "containerVolumeLitres must be a positive number when containerType is present"
      );
    }
    if (typeof dto.depositSystemVerified !== "boolean") {
      errors.push("depositSystemVerified must be a boolean");
    }
  }
  if (dto.exciseBase !== null && dto.exciseBase !== void 0) {
    const result = exciseBaseSchema.safeParse(dto.exciseBase);
    if (!result.success) {
      const nested = result.error.issues.map((issue2) => issue2.message).join("; ");
      errors.push(`exciseBase: ${nested}`);
    }
  }
  if (errors.length > 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: errors.join("; "),
      error: "ValidationError"
    });
  }
}
__name(validateLandedCost, "validateLandedCost");
function exciseBaseOf(dto) {
  return dto.exciseBase === null || dto.exciseBase === void 0 ? null : dto.exciseBase;
}
__name(exciseBaseOf, "exciseBaseOf");
async function calculateExcise(c) {
  const dto = await parseDto(c, exciseBaseSchema);
  const exciseService = new AlcoholExciseService(new D1TaxRuleRepositoryAdapter(c.env.DB));
  const result = await exciseService.calculate(
    dto.category,
    dto.alcoholByVolume,
    dto.volumeLitres
  );
  return c.json(mapExciseResult(dto, result));
}
__name(calculateExcise, "calculateExcise");
async function calculateLandedCost(c) {
  const dto = await parseDto(c, landedCostSchema);
  validateLandedCost(dto);
  const taxRepo = new D1TaxRuleRepositoryAdapter(c.env.DB);
  const exciseService = new AlcoholExciseService(taxRepo);
  const containerDutyService = new ContainerDutyService(taxRepo);
  const exciseBase = exciseBaseOf(dto);
  const exciseDuty = exciseBase !== null ? mapExciseResult(
    exciseBase,
    await exciseService.calculate(
      exciseBase.category,
      exciseBase.alcoholByVolume,
      exciseBase.volumeLitres
    )
  ) : null;
  const containerDuty = dto.containerType !== null ? mapContainerDutyResult(
    dto.containerType,
    await containerDutyService.calculate(
      dto.containerVolumeLitres,
      dto.containerType,
      dto.depositSystemVerified
    )
  ) : null;
  return c.json({
    retailPriceCents: dto.retailPriceCents,
    transportCostCents: dto.transportCostCents,
    exciseDuty,
    containerDuty,
    totalCostCents: dto.retailPriceCents + dto.transportCostCents + (exciseDuty?.exciseAmountCents ?? 0) + (containerDuty?.dutyAmountCents ?? 0),
    currency: "EUR",
    disclaimer: DISCLAIMER_FI,
    calculationTimestamp: /* @__PURE__ */ new Date(),
    transactionClass: dto.transactionClass
  });
}
__name(calculateLandedCost, "calculateLandedCost");
function registerCalculatorRoutes(app2) {
  app2.post("/api/v1/calculator", calculate);
  app2.get("/api/v1/calculator/result/:recordId", getResult);
  app2.post("/api/v1/calculations/excise", calculateExcise);
  app2.post("/api/v1/calculations/landed-cost", calculateLandedCost);
  return app2;
}
__name(registerCalculatorRoutes, "registerCalculatorRoutes");

// src/routes/search.routes.ts
init_modules_watch_stub();

// src/services/merchant-reliability.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/merchant-reliability.repository.ts
init_modules_watch_stub();
var MerchantReliabilityRepository = class {
};
__name(MerchantReliabilityRepository, "MerchantReliabilityRepository");
MerchantReliabilityRepository = __decorateClass([
  Injectable()
], MerchantReliabilityRepository);
var CURRENT_OFFER_AGGREGATES_SQL = `
  WITH ranked AS (
    SELECT merchant, reliability_status, observed_at,
           ROW_NUMBER() OVER (
             PARTITION BY merchant, product_id
             ORDER BY observed_at DESC, id DESC
           ) AS rn
      FROM retail_offers
  )
  SELECT merchant,
         COUNT(*) AS offer_count,
         SUM(CASE WHEN reliability_status = 'VERIFIED' THEN 1 ELSE 0 END)
           AS verified_count,
         SUM(CASE WHEN reliability_status IS NOT 'VERIFIED'
                   AND reliability_status IS NOT 'STALE'
                   AND reliability_status IS NOT 'UNAVAILABLE'
                  THEN 1 ELSE 0 END)
           AS estimated_count,
         SUM(CASE WHEN reliability_status = 'STALE' THEN 1 ELSE 0 END)
           AS stale_count,
         SUM(CASE WHEN reliability_status = 'UNAVAILABLE' THEN 1 ELSE 0 END)
           AS unavailable_count,
         MAX(observed_at) AS freshest_observed_at
    FROM ranked
   WHERE rn = 1
   GROUP BY merchant
   ORDER BY merchant ASC`;
var D1MerchantReliabilityRepository = class extends MerchantReliabilityRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async findCurrentOfferAggregates() {
    const rows = (await this.d1.prepare(CURRENT_OFFER_AGGREGATES_SQL).all()).results;
    return rows.map((row) => ({
      merchant: row.merchant,
      offerCount: Number(row.offer_count),
      statusCounts: {
        VERIFIED: Number(row.verified_count),
        ESTIMATED: Number(row.estimated_count),
        STALE: Number(row.stale_count),
        UNAVAILABLE: Number(row.unavailable_count)
      },
      freshestObservedAt: new Date(row.freshest_observed_at)
    }));
  }
};
__name(D1MerchantReliabilityRepository, "D1MerchantReliabilityRepository");
D1MerchantReliabilityRepository = __decorateClass([
  Injectable()
], D1MerchantReliabilityRepository);

// src/services/merchant-reliability.ts
var UNKNOWN_PERMISSION_STATUS = "PENDING";
function toDto(score) {
  return {
    merchant: score.merchant,
    offerCount: score.offerCount,
    statusCounts: { ...score.statusCounts },
    statusShares: { ...score.statusShares },
    strictestStatus: score.strictestStatus,
    freshestObservedAt: score.freshestObservedAt === null ? null : score.freshestObservedAt.toISOString(),
    governancePermissionStatus: score.governancePermissionStatus,
    computedAt: score.computedAt.toISOString()
  };
}
__name(toDto, "toDto");
function scoreAggregate(scoreService, aggregate) {
  return toDto(
    scoreService.computeScore({
      merchant: aggregate.merchant,
      statusCounts: aggregate.statusCounts,
      offerCount: aggregate.offerCount,
      freshestObservedAt: aggregate.freshestObservedAt,
      governancePermissionStatus: UNKNOWN_PERMISSION_STATUS
    })
  );
}
__name(scoreAggregate, "scoreAggregate");
async function getReliabilityScores(d1) {
  const scoreService = new MerchantReliabilityScoreService(new ReliabilityService());
  const aggregates = await new D1MerchantReliabilityRepository(d1).findCurrentOfferAggregates();
  return aggregates.map((aggregate) => scoreAggregate(scoreService, aggregate));
}
__name(getReliabilityScores, "getReliabilityScores");
async function getMerchantReliabilityMap(d1, merchants) {
  try {
    const scores = (await getReliabilityScores(d1)).filter(
      (score) => merchants.has(score.merchant)
    );
    const map = {};
    for (const score of scores) {
      map[score.merchant] = score;
    }
    return map;
  } catch {
    return void 0;
  }
}
__name(getMerchantReliabilityMap, "getMerchantReliabilityMap");

// src/routes/search.routes.ts
var DEFAULT_PAGE_SIZE = 20;
var MAX_PAGE_SIZE = 100;
function compareByName(a, b) {
  return a.name.localeCompare(b.name, "fi");
}
__name(compareByName, "compareByName");
function compareByNameThenId(a, b) {
  return compareByName(a, b) || a.id - b.id;
}
__name(compareByNameThenId, "compareByNameThenId");
function toSearchItem(p) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    alcoholByVolume: p.alcoholByVolume !== null ? parseFloat(p.alcoholByVolume) : null,
    unitVolume: p.unitVolume,
    containerType: p.containerType,
    lowestPriceCents: null,
    merchantCount: 0
  };
}
__name(toSearchItem, "toSearchItem");
function parsePositiveInt(raw2, fallback) {
  if (raw2 === void 0 || raw2 === "") return fallback;
  const n = Number.parseInt(raw2, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
__name(parsePositiveInt, "parsePositiveInt");
async function search(c) {
  const ids = c.req.query("ids");
  const q = c.req.query("q");
  const sort = c.req.query("sort");
  const page = c.req.query("page");
  const limit = c.req.query("limit");
  const pageNum = parsePositiveInt(page, 1);
  const limitNum = Math.min(parsePositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const sortBy = sort ?? "ALPHABETICAL";
  if (sortBy !== "ALPHABETICAL") {
    throw new ApiHttpError(
      400,
      `Sort order '${sortBy}' is not supported in Phase 1. Only ALPHABETICAL is available.`
    );
  }
  try {
    const repo = new D1ProductSearchRepository(c.env.DB);
    let items = [];
    const query = q !== void 0 ? q.trim() : "";
    if (ids !== void 0 && ids.trim().length > 0) {
      const productIds = ids.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
      const products = await Promise.all(productIds.map((id) => repo.findById(id)));
      items = products.filter((p) => p !== null).map((p) => toSearchItem(p));
      items.sort(compareByName);
    } else if (query.length > 0) {
      const products = await repo.searchRanked(query, MAX_PAGE_SIZE);
      items = products.map((p) => toSearchItem(p));
      if (sort !== void 0) {
        items.sort(compareByNameThenId);
      }
    } else {
      const products = await repo.searchByName(q ?? null, MAX_PAGE_SIZE);
      items = products.map((p) => toSearchItem(p));
      items.sort(compareByName);
    }
    const start = (pageNum - 1) * limitNum;
    const paginated = items.slice(start, start + limitNum);
    return c.json({
      items: paginated,
      total: items.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(items.length / limitNum)
    });
  } catch (err) {
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Product search failed"
    );
  }
}
__name(search, "search");
async function getProduct(c) {
  const id = parseIntParam(c, "id");
  try {
    const repo = new D1ProductSearchRepository(c.env.DB);
    const product = await repo.findById(id);
    if (product === null) {
      throw new ApiHttpError(404, `Product ${id} not found`);
    }
    const offers = await repo.findOffers(id);
    const response = {
      product: {
        id: product.id,
        name: product.name,
        manufacturer: product.manufacturer,
        brand: product.brand,
        category: product.category,
        alcoholByVolume: product.alcoholByVolume !== null ? parseFloat(product.alcoholByVolume) : null,
        unitVolume: product.unitVolume,
        containerType: product.containerType,
        regulatoryClassification: product.regulatoryClassification,
        depositSystemStatus: product.depositSystemStatus ?? false,
        ean: product.ean
      },
      offers: offers.map((o) => ({
        id: o.id,
        merchant: o.merchant,
        country: o.country,
        priceCents: o.priceCents,
        currency: o.currency,
        availability: o.availability,
        sourceUrl: o.sourceUrl,
        observedAt: o.observedAt instanceof Date ? o.observedAt.toISOString() : String(o.observedAt),
        reliabilityStatus: o.reliabilityStatus
      }))
    };
    const offersList = response.offers;
    if (offersList.length > 0 && new FeatureFlagService(c.env).isEnabled(FeatureFlag.ADVANCED_FEATURES)) {
      const merchants = new Set(offersList.map((o) => o.merchant));
      const embed = await getMerchantReliabilityMap(c.env.DB, merchants);
      if (embed !== void 0) {
        return c.json({ ...response, merchantReliability: embed });
      }
    }
    return c.json(response);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Failed to fetch product detail"
    );
  }
}
__name(getProduct, "getProduct");
function registerSearchRoutes(app2) {
  for (const path of ["/api/v1/products", "/api/v1/products/:id"]) {
    app2.on("GET", path, requireLaunchGate("PRICE_DATA"), ageGate());
  }
  app2.get("/api/v1/products", search);
  app2.get("/api/v1/products/:id", getProduct);
  return app2;
}
__name(registerSearchRoutes, "registerSearchRoutes");

// src/routes/declaration.routes.ts
init_modules_watch_stub();
async function prepareDeclaration(c) {
  const recordId = parseIntParam(c, "recordId");
  try {
    const service = new ExciseDeclarationService(
      new D1CalculationRecordQueryAdapter(c.env.DB)
    );
    const summary = await service.prepareDeclaration(recordId);
    if (!new FeatureFlagService(c.env).isEnabled(FeatureFlag.ADVANCED_FEATURES)) {
      return c.json(stripGuidance(summary));
    }
    return c.json(summary);
  } catch (err) {
    if (err instanceof Error && err.name === "CalculationRecordNotFoundError") {
      throw new ApiHttpError(404, err.message);
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Failed to prepare declaration summary"
    );
  }
}
__name(prepareDeclaration, "prepareDeclaration");
function stripGuidance(summary) {
  const { guidance: _gatedOff, ...withoutGuidance } = summary;
  return withoutGuidance;
}
__name(stripGuidance, "stripGuidance");
function registerDeclarationRoutes(app2) {
  app2.get("/api/v1/declaration/:recordId", prepareDeclaration);
  return app2;
}
__name(registerDeclarationRoutes, "registerDeclarationRoutes");

// src/routes/basket.routes.ts
init_modules_watch_stub();
function buildBasketOptimizerService(d1) {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  const calculator = new LandedCostCalculatorService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRepo),
    new ContainerDutyService(taxRepo),
    new TransactionClassificationService(new TransportClassificationService()),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1))
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1CalculationRecordPort(d1)
  );
  const optimizer = new BasketOptimizerService(
    new ClassificationGateService(),
    calculator,
    new BasketShippingCalculator(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1))
    ),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1MerchantTermsPort(d1),
    new D1BasketCalculationRecordPort(d1),
    new ConfidenceFrameworkService(new ReliabilityService())
  );
  return { optimizer, taxRepo };
}
__name(buildBasketOptimizerService, "buildBasketOptimizerService");
function validateOptimizeRequest(dto) {
  const errors = [];
  if (!Array.isArray(dto.items)) {
    errors.push("items must be an array");
  } else {
    if (dto.items.length < 1) {
      errors.push("items must contain at least 1 item");
    } else if (dto.items.length > MAX_BASKET_ITEMS) {
      errors.push(`items must contain at most ${MAX_BASKET_ITEMS} items`);
    }
    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      if (typeof item !== "object" || item === null || !Number.isInteger(item.productId) || item.productId <= 0) {
        errors.push(`items[${i}].productId must be a positive integer`);
      }
      if (typeof item !== "object" || item === null || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        errors.push(`items[${i}].quantity must be a positive integer between 1 and 99`);
      }
    }
  }
  if (typeof dto.destination !== "string" || dto.destination.length !== 2) {
    errors.push("destination must be a 2-letter ISO 3166-1 alpha-2 country code");
  }
  if (dto.transportMethod !== void 0 && typeof dto.transportMethod !== "string") {
    errors.push("transportMethod must be a string when provided");
  }
  if (dto.transportArrangement !== void 0 && !["SELLER_ARRANGED", "INDEPENDENT_CARRIER", "PERSONAL"].includes(dto.transportArrangement)) {
    errors.push(
      "transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL"
    );
  }
  if (dto.sessionId !== void 0 && typeof dto.sessionId !== "string") {
    errors.push("sessionId must be a string when provided");
  }
  if (errors.length > 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: errors.join("; "),
      error: "ValidationError"
    });
  }
}
__name(validateOptimizeRequest, "validateOptimizeRequest");
async function parseRawBody(c) {
  try {
    return await c.req.json();
  } catch {
    throw new ApiHttpError(400, "Request body must be JSON");
  }
}
__name(parseRawBody, "parseRawBody");
async function optimize(c) {
  const dto = await parseRawBody(c);
  validateOptimizeRequest(dto);
  const input = {
    items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    transportArrangement: dto.transportArrangement,
    sessionId: dto.sessionId
  };
  const idempotencyKey = c.req.header("x-idempotency-key");
  const rawKey = await idempotencyCacheKey({
    productId: 0,
    quantity: 0,
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
  });
  const cacheKey = idempotencyKey ?? `basket:${rawKey}`;
  const { optimizer, taxRepo } = buildBasketOptimizerService(c.env.DB);
  const currentVersions = await taxRepo.findActiveVersionLabels();
  const cached = await idempotencyLookup(c.env, cacheKey, currentVersions);
  if (cached !== null) {
    c.header("X-Cache", "HIT");
    c.header("X-Content-Hash", await idempotencyContentHash(cached.result));
    return c.json(cached.result);
  }
  try {
    const result = await optimizer.optimize(input);
    await idempotencyStore(c.env, cacheKey, result, {
      datasetVersions: result.metadata.datasetVersions.length > 0 ? result.metadata.datasetVersions : currentVersions
    });
    c.header("X-Cache", "MISS");
    c.header("X-Content-Hash", await idempotencyContentHash(result));
    return c.json(result);
  } catch (err) {
    if (err instanceof BasketValidationError) {
      if (err.code === "PRODUCT_NOT_FOUND" || err.code === "NO_OFFERS") {
        throw new ApiHttpError(404, err.message);
      }
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: "BasketValidationError",
        code: err.code
      });
    }
    if (err instanceof BasketClassificationGateError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: "BasketClassificationGateRejection",
        productId: err.productId
      });
    }
    if (err instanceof BasketCombinationLimitError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: "BasketCombinationLimitExceeded",
        totalCombinations: err.totalCombinations,
        limit: err.limit
      });
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Unexpected basket optimization error"
    );
  }
}
__name(optimize, "optimize");
function registerBasketRoutes(app2) {
  app2.post("/api/v1/basket/optimize", optimize);
  return app2;
}
__name(registerBasketRoutes, "registerBasketRoutes");

// src/routes/historical.routes.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/price-history-summary.repository.ts
init_modules_watch_stub();
var SUMMARY_COLUMNS = `
  id, granularity, period_start, product_id, merchant,
  price_open_cents, price_close_cents, price_min_cents, price_max_cents,
  price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
  landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
  observation_count, strictest_reliability`;
function toContractRecord3(row) {
  return {
    id: row.id,
    granularity: row.granularity,
    periodStart: row.period_start,
    productId: row.product_id,
    merchant: row.merchant,
    priceOpenCents: row.price_open_cents,
    priceCloseCents: row.price_close_cents,
    priceMinCents: row.price_min_cents,
    priceMaxCents: row.price_max_cents,
    priceAvgCents: row.price_avg_cents,
    landedCostOpenCents: row.landed_cost_open_cents,
    landedCostCloseCents: row.landed_cost_close_cents,
    landedCostMinCents: row.landed_cost_min_cents,
    landedCostMaxCents: row.landed_cost_max_cents,
    landedCostAvgCents: row.landed_cost_avg_cents,
    observationCount: row.observation_count,
    strictestReliability: row.strictest_reliability
  };
}
__name(toContractRecord3, "toContractRecord");
function aggregateParams(summary) {
  return [
    summary.priceOpenCents,
    summary.priceCloseCents,
    summary.priceMinCents,
    summary.priceMaxCents,
    summary.priceAvgCents,
    summary.landedCostOpenCents,
    summary.landedCostCloseCents,
    summary.landedCostMinCents,
    summary.landedCostMaxCents,
    summary.landedCostAvgCents,
    summary.observationCount,
    summary.strictestReliability
  ];
}
__name(aggregateParams, "aggregateParams");
var BUCKET_LOOKUP_SQL = `
  SELECT id FROM price_history_summaries
   WHERE granularity = ? AND period_start = ? AND product_id = ?
     AND merchant IS ?`;
var INSERT_SQL4 = `
  INSERT INTO price_history_summaries (
    granularity, period_start, product_id, merchant,
    price_open_cents, price_close_cents, price_min_cents, price_max_cents,
    price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
    landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
    observation_count, strictest_reliability
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;
var UPDATE_SQL = `
  UPDATE price_history_summaries SET
    price_open_cents = ?, price_close_cents = ?, price_min_cents = ?,
    price_max_cents = ?, price_avg_cents = ?,
    landed_cost_open_cents = ?, landed_cost_close_cents = ?,
    landed_cost_min_cents = ?, landed_cost_max_cents = ?,
    landed_cost_avg_cents = ?, observation_count = ?,
    strictest_reliability = ?
   WHERE id = ?
   RETURNING id`;
var RANGE_READ_SQL = `
  SELECT ${SUMMARY_COLUMNS}
    FROM price_history_summaries
   WHERE granularity = ? AND product_id = ?
     AND period_start >= ? AND period_start <= ?
     AND merchant IS ?
   ORDER BY period_start ASC`;
var D1PriceHistorySummaryRepository = class extends PriceHistorySummaryRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /**
   * Insert or overwrite one bucket row keyed by (granularity, periodStart,
   * productId, merchant). Returns the row id (existing id on conflict —
   * the key columns never change). Last write wins: every computed column
   * is overwritten, the key columns and id are not.
   */
  async upsertBucket(summary) {
    const existing = await this.d1.prepare(BUCKET_LOOKUP_SQL).bind(
      summary.granularity,
      summary.periodStart,
      summary.productId,
      summary.merchant ?? null
    ).first();
    if (existing) {
      const row = await this.d1.prepare(UPDATE_SQL).bind(...aggregateParams(summary), existing.id).first();
      if (!row) {
        throw new Error(
          "price_history_summaries UPDATE .. RETURNING returned no row"
        );
      }
      return { id: row.id };
    }
    const inserted = await this.d1.prepare(INSERT_SQL4).bind(
      summary.granularity,
      summary.periodStart,
      summary.productId,
      summary.merchant ?? null,
      ...aggregateParams(summary)
    ).first();
    if (!inserted) {
      throw new Error(
        "price_history_summaries INSERT .. RETURNING returned no row"
      );
    }
    return { id: inserted.id };
  }
  /**
   * Range read of one product's summary series at one granularity over
   * the closed [from, to] period-start range. Omitting `merchant` (or
   * null) reads ONLY the product-wide rows (merchant IS NULL); a given
   * merchant reads only that merchant's rows — binary semantics, matching
   * the pg repository. Ordered by periodStart ascending.
   */
  async findByProductRange(productId, granularity, from, to, merchant) {
    const rows = (await this.d1.prepare(RANGE_READ_SQL).bind(granularity, productId, from, to, merchant ?? null).all()).results;
    return rows.map(toContractRecord3);
  }
};
__name(D1PriceHistorySummaryRepository, "D1PriceHistorySummaryRepository");
D1PriceHistorySummaryRepository = __decorateClass([
  Injectable()
], D1PriceHistorySummaryRepository);

// ../../packages/data-platform/src/d1/observation-log.ts
init_modules_watch_stub();
var OBSERVATION_LOG_PREFIX = "observations/";
var OBJECT_KEY_PATTERN = /^observations\/(\d{4}-\d{2}-\d{2})\.jsonl$/;
function partitionDay(observedAt) {
  const instant = typeof observedAt === "string" ? new Date(observedAt) : observedAt;
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError(
      `Invalid observedAt for observation-log partition: ${String(observedAt)}`
    );
  }
  return instant.toISOString().slice(0, 10);
}
__name(partitionDay, "partitionDay");
function observationObjectKey(observedAt) {
  return `${OBSERVATION_LOG_PREFIX}${partitionDay(observedAt)}.jsonl`;
}
__name(observationObjectKey, "observationObjectKey");
function observationPartitionDay(key) {
  const match2 = OBJECT_KEY_PATTERN.exec(key);
  return match2 ? match2[1] : null;
}
__name(observationPartitionDay, "observationPartitionDay");
var LINE_FIELD_ORDER = [
  "id",
  "product_id",
  "merchant",
  "retail_offer_id",
  "observed_at",
  "foreign_retail_price_cents",
  "transport_cost_cents",
  "transport_offer_id",
  "excise_rule_version_id",
  "container_duty_rule_version_id",
  "landed_cost_cents",
  "input_reliability",
  "confidence"
];
function serializeObservationLine(record) {
  const ordered = {};
  for (const field of LINE_FIELD_ORDER) {
    ordered[field] = record[field];
  }
  return JSON.stringify(ordered);
}
__name(serializeObservationLine, "serializeObservationLine");
function parseObservationLine(line) {
  if (line.trim().length === 0) {
    throw new TypeError("Cannot parse an empty observation-log line");
  }
  let value;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new TypeError(
      `Malformed observation-log line (invalid JSON): ${String(error)}`
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Observation-log line must be a JSON object");
  }
  const record = value;
  for (const field of LINE_FIELD_ORDER) {
    if (!(field in record)) {
      throw new TypeError(
        `Observation-log line is missing the required field '${field}'`
      );
    }
  }
  return value;
}
__name(parseObservationLine, "parseObservationLine");
function parseObservationLog(body) {
  const records = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    records.push(parseObservationLine(trimmed));
  }
  return records;
}
__name(parseObservationLog, "parseObservationLog");
function observationKeysToScan(keys, watermark) {
  const thresholdDay = watermark === null ? null : partitionDay(watermark);
  return keys.map((key) => ({ key, day: observationPartitionDay(key) })).filter((entry) => entry.day !== null).filter(
    (entry) => thresholdDay === null || entry.day >= thresholdDay
  ).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0).map((entry) => entry.key);
}
__name(observationKeysToScan, "observationKeysToScan");

// src/adapters/r2-observation-log.store.ts
init_modules_watch_stub();
function createR2ObservationLogStore(bucket) {
  return {
    appendLine: /* @__PURE__ */ __name(async (key, line) => {
      const existing = await bucket.get(key);
      const body = existing === null ? "" : await existing.text();
      const next = body.length === 0 ? `${line}
` : `${body}${line}
`;
      await bucket.put(key, next);
    }, "appendLine"),
    listKeys: /* @__PURE__ */ __name(async (prefix) => {
      const keys = [];
      let cursor;
      for (; ; ) {
        const page = await bucket.list({ prefix, cursor });
        for (const object of page.objects) {
          keys.push(object.key);
        }
        if (page.truncated) {
          cursor = page.cursor;
          continue;
        }
        return keys.sort();
      }
    }, "listKeys"),
    readObject: /* @__PURE__ */ __name(async (key) => {
      const object = await bucket.get(key);
      return object === null ? null : object.text();
    }, "readObject")
  };
}
__name(createR2ObservationLogStore, "createR2ObservationLogStore");
function observationLogStore(env) {
  if (!env.OBSERVATION_LOG) {
    throw new Error("OBSERVATION_LOG R2 bucket binding is not configured");
  }
  return createR2ObservationLogStore(env.OBSERVATION_LOG);
}
__name(observationLogStore, "observationLogStore");

// src/routes/historical.routes.ts
var MAX_RANGE_DAYS = 365;
var DAY_MS = 24 * 60 * 60 * 1e3;
var CONTAINER_DUTY_PRODUCT_CATEGORY = "all_beverages";
var GRANULARITY_TO_SUMMARY = { day: "daily", week: "weekly" };
function parseIsoDate(raw2) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw2)) return null;
  const [y, m, d] = raw2.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
__name(parseIsoDate, "parseIsoDate");
function validateQuery(metric, granularity, from, to, merchant) {
  const errors = [];
  let metricValue = "price";
  if (metric !== void 0 && metric !== "price" && metric !== "landed-cost") {
    errors.push("metric must be one of: price, landed-cost");
  } else if (metric !== void 0) {
    metricValue = metric;
  }
  let granularityValue = "day";
  if (granularity !== void 0 && granularity !== "day" && granularity !== "week") {
    errors.push("granularity must be one of: day, week");
  } else if (granularity !== void 0) {
    granularityValue = granularity;
  }
  if (from === void 0 || parseIsoDate(from) === null) {
    errors.push("from is required and must be an ISO date (YYYY-MM-DD)");
  }
  if (to === void 0 || parseIsoDate(to) === null) {
    errors.push("to is required and must be an ISO date (YYYY-MM-DD)");
  }
  if (errors.length === 0 && from !== void 0 && to !== void 0) {
    const fromMs = parseIsoDate(from).getTime();
    const toMs = parseIsoDate(to).getTime();
    if (toMs < fromMs) {
      errors.push("to must not be before from");
    } else if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) {
      errors.push(`requested range must not exceed ${MAX_RANGE_DAYS} days`);
    }
  }
  if (merchant !== void 0 && (merchant.length === 0 || merchant.length > 128)) {
    errors.push("merchant must be a non-empty string of at most 128 characters");
  }
  if (errors.length > 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: errors.join("; "),
      error: "ValidationError"
    });
  }
  return {
    metric: metricValue,
    granularity: granularityValue,
    from,
    to,
    merchant: merchant !== void 0 ? merchant : null
  };
}
__name(validateQuery, "validateQuery");
async function findObservationsByProductRange(env, productId, from, to, merchant) {
  const reader = observationLogStore(env);
  const allKeys = await reader.listKeys(OBSERVATION_LOG_PREFIX);
  const keys = observationKeysToScan(allKeys, from).filter((key) => {
    const day = key.slice(OBSERVATION_LOG_PREFIX.length, OBSERVATION_LOG_PREFIX.length + 10);
    return day <= to.toISOString().slice(0, 10);
  });
  const rows = [];
  for (const key of keys) {
    const body = await reader.readObject(key);
    if (body === null) continue;
    for (const line of body.split("\n")) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = parseObservationLine(line);
      } catch {
        continue;
      }
      if (record.product_id !== productId) continue;
      const observedAt = new Date(record.observed_at);
      if (observedAt < from || observedAt >= to) continue;
      if (merchant !== null && record.merchant !== merchant) continue;
      rows.push({
        productId: record.product_id,
        merchant: record.merchant,
        retailOfferId: record.retail_offer_id,
        observedAt,
        foreignRetailPriceCents: record.foreign_retail_price_cents,
        transportOfferId: record.transport_offer_id,
        transportCostCents: record.transport_cost_cents,
        exciseRuleVersionId: record.excise_rule_version_id,
        containerDutyRuleVersionId: record.container_duty_rule_version_id,
        landedCostCents: record.landed_cost_cents,
        inputReliability: narrowInputReliability(record.input_reliability),
        confidence: narrowConfidence(record.confidence)
      });
    }
  }
  rows.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  return rows;
}
__name(findObservationsByProductRange, "findObservationsByProductRange");
async function findEarliestObservedAt(env, productId, merchant) {
  const reader = observationLogStore(env);
  const keys = await reader.listKeys(OBSERVATION_LOG_PREFIX);
  let earliest = null;
  for (const key of keys) {
    const body = await reader.readObject(key);
    if (body === null) continue;
    for (const line of body.split("\n")) {
      if (line.trim().length === 0) continue;
      let record;
      try {
        record = parseObservationLine(line);
      } catch {
        continue;
      }
      if (record.product_id !== productId) continue;
      if (merchant !== null && record.merchant !== merchant) continue;
      const observedAt = new Date(record.observed_at);
      if (earliest === null || observedAt < earliest) earliest = observedAt;
    }
  }
  return earliest;
}
__name(findEarliestObservedAt, "findEarliestObservedAt");
function narrowReliability(value) {
  return value === "VERIFIED" || value === "STALE" || value === "UNAVAILABLE" ? value : "ESTIMATED";
}
__name(narrowReliability, "narrowReliability");
function narrowInputReliability(raw2) {
  const record = raw2 ?? {};
  return {
    retailPrice: narrowReliability(record.retailPrice),
    transport: narrowReliability(record.transport),
    exciseRule: narrowReliability(record.exciseRule),
    containerDutyRule: narrowReliability(record.containerDutyRule)
  };
}
__name(narrowInputReliability, "narrowInputReliability");
function narrowConfidence(value) {
  return value === "HIGH" || value === "MEDIUM" ? value : "LOW";
}
__name(narrowConfidence, "narrowConfidence");
function toEffectiveWindow(rule) {
  return {
    ruleId: rule.id,
    versionLabel: rule.versionLabel,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo
  };
}
__name(toEffectiveWindow, "toEffectiveWindow");
function resolveSnapshot(ruleId, windows) {
  if (ruleId === null) return null;
  const window = windows.find((w) => w.ruleId === ruleId);
  return window !== void 0 ? { ruleId, versionLabel: window.versionLabel } : null;
}
__name(resolveSnapshot, "resolveSnapshot");
async function getPriceHistory(c) {
  const id = parseIntParam(c, "id");
  const query = validateQuery(
    c.req.query("metric"),
    c.req.query("granularity"),
    c.req.query("from"),
    c.req.query("to"),
    c.req.query("merchant")
  );
  try {
    const product = await new D1ProductSearchRepository(c.env.DB).findById(id);
    if (product === null) {
      throw new ApiHttpError(404, `Product ${id} not found`);
    }
    const fromDate = parseIsoDate(query.from);
    const toExclusive = new Date(parseIsoDate(query.to).getTime() + DAY_MS);
    const summaries = await new D1PriceHistorySummaryRepository(c.env.DB).findByProductRange(
      id,
      GRANULARITY_TO_SUMMARY[query.granularity],
      query.from,
      query.to,
      query.merchant
    );
    const series = summaries.map((row) => {
      const open = query.metric === "price" ? row.priceOpenCents : row.landedCostOpenCents;
      const close = query.metric === "price" ? row.priceCloseCents : row.landedCostCloseCents;
      const min = query.metric === "price" ? row.priceMinCents : row.landedCostMinCents;
      const max = query.metric === "price" ? row.priceMaxCents : row.landedCostMaxCents;
      const avg = query.metric === "price" ? row.priceAvgCents : row.landedCostAvgCents;
      return {
        periodStart: row.periodStart,
        openCents: open,
        closeCents: close,
        minCents: min,
        maxCents: max,
        avgCents: avg,
        observationCount: row.observationCount,
        reliability: narrowReliability(row.strictestReliability)
      };
    });
    const earliest = await findEarliestObservedAt(c.env, id, query.merchant);
    const exciseCategory = normaliseCategory(product.category);
    const taxRepo = new D1TaxRateRepository(c.env.DB);
    const [exciseRules, containerDutyRules] = await Promise.all([
      taxRepo.findHistoryRates(TAX_TYPES.excise, exciseCategory, fromDate, toExclusive),
      taxRepo.findHistoryRates(
        TAX_TYPES.containerDuty,
        CONTAINER_DUTY_PRODUCT_CATEGORY,
        fromDate,
        toExclusive
      )
    ]);
    const exciseWindows = exciseRules.map(toEffectiveWindow);
    const containerDutyWindows = containerDutyRules.map(toEffectiveWindow);
    const records = await findObservationsByProductRange(
      c.env,
      id,
      fromDate,
      toExclusive,
      query.merchant
    );
    const attribution = [];
    if (records.length >= 2) {
      const seriesByMerchant = /* @__PURE__ */ new Map();
      for (const record of records) {
        const list = seriesByMerchant.get(record.merchant) ?? [];
        list.push({
          productId: record.productId,
          merchant: record.merchant,
          retailOfferId: record.retailOfferId,
          observedAt: record.observedAt,
          foreignRetailPriceCents: record.foreignRetailPriceCents,
          transportOfferId: record.transportOfferId,
          transportCostCents: record.transportCostCents,
          exciseRuleVersion: resolveSnapshot(record.exciseRuleVersionId, exciseWindows),
          containerDutyRuleVersion: resolveSnapshot(
            record.containerDutyRuleVersionId,
            containerDutyWindows
          ),
          landedCostCents: record.landedCostCents,
          inputReliability: record.inputReliability,
          confidence: record.confidence
        });
        seriesByMerchant.set(record.merchant, list);
      }
      const attributionService = new TaxChangeAttributionService();
      for (const [seriesMerchant, observations] of seriesByMerchant) {
        const steps = attributionService.attribute({
          observations,
          exciseRuleWindows: exciseWindows,
          containerDutyRuleWindows: containerDutyWindows
        });
        for (const step of steps) {
          if (step.classification === "UNCHANGED") continue;
          attribution.push({
            merchant: seriesMerchant,
            classification: step.classification,
            fromObservedAt: step.fromObservedAt.toISOString(),
            toObservedAt: step.toObservedAt.toISOString(),
            movedInputs: step.movedInputs,
            exciseRuleBoundary: step.exciseRuleBoundary,
            containerDutyRuleBoundary: step.containerDutyRuleBoundary
          });
        }
      }
      attribution.sort((a, b) => {
        const entryA = a;
        const entryB = b;
        const byTime = entryA.toObservedAt.localeCompare(entryB.toObservedAt);
        return byTime !== 0 ? byTime : entryA.merchant.localeCompare(entryB.merchant);
      });
    }
    return c.json({
      productId: id,
      merchant: query.merchant,
      metric: query.metric,
      granularity: query.granularity,
      from: query.from,
      to: query.to,
      series,
      attribution,
      earliestAvailableObservationDate: earliest !== null ? earliest.toISOString() : null
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Failed to fetch price history"
    );
  }
}
__name(getPriceHistory, "getPriceHistory");
function registerHistoricalRoutes(app2) {
  app2.on(
    "GET",
    "/api/v1/products/:id/price-history",
    requireFeatureFlag(FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE),
    ageGate()
  );
  app2.get("/api/v1/products/:id/price-history", getPriceHistory);
  return app2;
}
__name(registerHistoricalRoutes, "registerHistoricalRoutes");

// src/routes/reports.routes.ts
init_modules_watch_stub();

// ../../packages/application-api/src/reports/report-export.service.ts
init_modules_watch_stub();
var NOT_PERSISTED = "NOT_PERSISTED";
var CSV_COLUMNS = [
  "record_id",
  "label",
  "category",
  "amount_cents",
  "reliability",
  "dataset_version",
  "language",
  "timestamp",
  "detail"
];
function buildFigureRows(record) {
  const exciseVersion = record.exciseRuleVersionLabel ?? NOT_PERSISTED;
  const containerVersion = record.containerDutyRuleVersionLabel ?? NOT_PERSISTED;
  return [
    {
      label: "Alcohol excise",
      category: "alcohol_excise",
      amountCents: record.alcoholExciseCents,
      reliability: record.confidence,
      datasetVersion: exciseVersion,
      language: "",
      timestamp: record.calculationTimestamp,
      detail: ""
    },
    {
      label: "Container duty",
      category: "container_duty",
      amountCents: record.containerDutyCents,
      reliability: record.confidence,
      datasetVersion: containerVersion,
      language: "",
      timestamp: record.calculationTimestamp,
      detail: ""
    },
    {
      label: "Total",
      category: "total",
      amountCents: record.totalCents,
      reliability: record.confidence,
      // The total spans both rule sets — carry both contributing labels
      // rather than inventing a single version for a composite figure.
      datasetVersion: `excise=${exciseVersion};container=${containerVersion}`,
      language: "",
      timestamp: record.calculationTimestamp,
      detail: ""
    }
  ];
}
__name(buildFigureRows, "buildFigureRows");
function buildDisclaimerRow(record) {
  return {
    label: "Disclaimer",
    category: "disclaimer",
    amountCents: null,
    reliability: record.confidence,
    datasetVersion: record.disclaimerVersion,
    language: record.disclaimerLanguage,
    timestamp: record.calculationTimestamp,
    detail: record.disclaimerText
  };
}
__name(buildDisclaimerRow, "buildDisclaimerRow");
function buildJsonReport(record) {
  return {
    format: "json",
    recordId: record.id,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    record
  };
}
__name(buildJsonReport, "buildJsonReport");
function escapeCsvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
__name(escapeCsvField, "escapeCsvField");
function rowToCsv(recordId, row) {
  return [
    String(recordId),
    row.label,
    row.category,
    row.amountCents === null ? "" : String(row.amountCents),
    row.reliability,
    row.datasetVersion,
    row.language,
    row.timestamp,
    row.detail
  ].map(escapeCsvField).join(",");
}
__name(rowToCsv, "rowToCsv");
function buildCsvReport(record) {
  const lines = [
    CSV_COLUMNS.join(","),
    ...buildFigureRows(record).map((row) => rowToCsv(record.id, row)),
    rowToCsv(record.id, buildDisclaimerRow(record))
  ];
  return `${lines.join("\r\n")}\r
`;
}
__name(buildCsvReport, "buildCsvReport");
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
function textOrUnknown(value) {
  return value === null || value === "" ? "UNKNOWN" : value;
}
__name(textOrUnknown, "textOrUnknown");
function depositStatus(status) {
  if (status === true) return "IN_DEPOSIT_SYSTEM";
  if (status === false) return "NOT_IN_DEPOSIT_SYSTEM";
  return "UNKNOWN";
}
__name(depositStatus, "depositStatus");
function htmlRow(cells) {
  const tds = cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("");
  return `<tr>${tds}</tr>`;
}
__name(htmlRow, "htmlRow");
function htmlDefRow(label, value) {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}
__name(htmlDefRow, "htmlDefRow");
function buildHtmlReport(record) {
  const rows = buildFigureRows(record).map(
    (row) => htmlRow([
      row.label,
      row.category,
      row.amountCents === null ? "" : String(row.amountCents),
      row.reliability,
      row.datasetVersion,
      row.timestamp
    ])
  ).join("\n      ");
  return `<!DOCTYPE html>
<html lang="${escapeHtml(record.disclaimerLanguage)}">
<head>
<meta charset="utf-8">
<title>Calculation report ${record.id} \u2014 ${escapeHtml(record.productName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; margin: 2rem auto; max-width: 46rem; color: #111; line-height: 1.45; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; border-bottom: 1px solid #999; padding-bottom: 0.2rem; }
  .meta { color: #444; font-size: 0.85rem; margin-bottom: 1rem; }
  .row { display: flex; justify-content: space-between; padding: 0.15rem 0; border-bottom: 1px dotted #ccc; }
  .label { color: #444; }
  .value { font-weight: bold; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { border: 1px solid #999; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .disclaimer { margin-top: 1.5rem; border: 2px solid #333; padding: 0.75rem 1rem; }
  .disclaimer p { margin: 0.5rem 0 0 0; }
  .disclaimer .version { font-size: 0.8rem; color: #444; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Calculation report</h1>
<p class="meta">Record ${record.id} \xB7 generated ${escapeHtml((/* @__PURE__ */ new Date()).toISOString())} \xB7 figures verbatim from the persisted calculation</p>

<h2>Product</h2>
${htmlDefRow("Name", record.productName)}
${htmlDefRow("Brand", textOrUnknown(record.productBrand))}
${htmlDefRow("Category", record.productCategory)}
${htmlDefRow("Alcohol by volume (%)", String(record.alcoholByVolume))}
${htmlDefRow("Volume (litres)", String(record.volumeLitres))}
${htmlDefRow("Quantity", String(record.quantity))}
${htmlDefRow("Container type", record.containerType)}
${htmlDefRow("Deposit system", depositStatus(record.depositSystemStatus))}

<h2>Transport</h2>
${htmlDefRow("Carrier", textOrUnknown(record.transportCarrier))}
${htmlDefRow("Origin", textOrUnknown(record.transportOrigin))}
${htmlDefRow("Destination", textOrUnknown(record.transportDestination))}

<h2>Assessment</h2>
${htmlDefRow("Classification", record.classification)}
${htmlDefRow("Confidence", record.confidence)}
${htmlDefRow("Calculated at", record.calculationTimestamp)}

<h2>Figures</h2>
<table>
  <thead>
    <tr><th>Label</th><th>Category</th><th>Amount (cents)</th><th>Reliability</th><th>Dataset version</th><th>Timestamp</th></tr>
  </thead>
  <tbody>
      ${rows}
  </tbody>
</table>

<div class="disclaimer">
  <strong>Disclaimer</strong>
  <p>${escapeHtml(record.disclaimerText)}</p>
  <p class="version">Version ${escapeHtml(record.disclaimerVersion)} \xB7 language ${escapeHtml(record.disclaimerLanguage)}</p>
</div>
</body>
</html>
`;
}
__name(buildHtmlReport, "buildHtmlReport");
var ReportExportService = class {
  constructor(recordQuery) {
    this.recordQuery = recordQuery;
  }
  recordQuery;
  /**
   * Load the persisted record — the single read path shared with the
   * declaration feature.
   *
   * @throws {CalculationRecordNotFoundError} when the record does not exist.
   * @throws {Error} when the query port is not wired to a concrete adapter.
   */
  async loadRecord(recordId) {
    if (!this.recordQuery) {
      throw new Error(
        "CALCULATION_RECORD_QUERY_PORT is not wired to a concrete adapter \u2014 bind one via ReportsModule.forRoot({ recordQueryPort }) from the composition root."
      );
    }
    const record = await this.recordQuery.findById(recordId);
    if (record === null) {
      throw new CalculationRecordNotFoundError(recordId);
    }
    return record;
  }
  /** Export the record as a lossless JSON report. */
  async exportJson(recordId) {
    return buildJsonReport(await this.loadRecord(recordId));
  }
  /** Export the record as an RFC-4180 flat CSV table. */
  async exportCsv(recordId) {
    return buildCsvReport(await this.loadRecord(recordId));
  }
  /** Export the record as a self-contained printable HTML page. */
  async exportHtml(recordId) {
    return buildHtmlReport(await this.loadRecord(recordId));
  }
};
__name(ReportExportService, "ReportExportService");
ReportExportService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(CALCULATION_RECORD_QUERY_PORT))
], ReportExportService);

// src/routes/reports.routes.ts
var attachOptionalSession = /* @__PURE__ */ __name(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (typeof token === "string" && token.length > 0) {
    const account = await resolveAccountByToken(c.env.DB, token);
    if (account !== null) {
      c.set(USER_CONTEXT_KEY, account);
      c.set("sessionToken", token);
    }
  }
  await next();
}, "attachOptionalSession");
function validateFormat(format) {
  if (format === void 0 || format === "") {
    return "json";
  }
  if (format === "json" || format === "csv" || format === "html") {
    return format;
  }
  throw new ApiHttpError(
    400,
    `Unsupported format '${format}'. Supported formats: json, csv, html.`
  );
}
__name(validateFormat, "validateFormat");
async function getReport(c) {
  const recordId = parseIntParam(c, "recordId");
  const normalized = validateFormat(c.req.query("format"));
  try {
    const adapter = new D1CalculationRecordQueryAdapter(c.env.DB);
    const record = await adapter.findById(recordId);
    if (record === null) {
      throw new ApiHttpError(404, `Calculation record ${recordId} not found`);
    }
    if (normalized === "json") {
      return c.json(buildJsonReport(record));
    }
    if (normalized === "csv") {
      const body2 = buildCsvReport(record);
      return new Response(body2, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="rajahinta-calculation-${recordId}.csv"`
        }
      });
    }
    const body = buildHtmlReport(record);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : "Failed to export report"
    );
  }
}
__name(getReport, "getReport");
function registerReportsRoutes(app2) {
  app2.use("/api/v1/reports/*", requireFeatureFlag(FeatureFlag.ADVANCED_FEATURES), ageGate());
  app2.on("GET", "/api/v1/reports/:recordId", attachOptionalSession, requireFeature("calculation:export"));
  app2.get("/api/v1/reports/:recordId", getReport);
  return app2;
}
__name(registerReportsRoutes, "registerReportsRoutes");

// src/routes/merchants.routes.ts
init_modules_watch_stub();
async function getReliability(c) {
  return c.json({ merchants: await getReliabilityScores(c.env.DB) });
}
__name(getReliability, "getReliability");
function registerMerchantsRoutes(app2) {
  app2.on(
    "GET",
    "/api/v1/merchants/reliability",
    requireLaunchGate("PRICE_DATA"),
    ageGate(),
    requireFeatureFlag(FeatureFlag.ADVANCED_FEATURES)
  );
  app2.get("/api/v1/merchants/reliability", getReliability);
  return app2;
}
__name(registerMerchantsRoutes, "registerMerchantsRoutes");

// src/routes/accounts.routes.ts
init_modules_watch_stub();

// src/adapters/account-store.ts
init_modules_watch_stub();
var PLACEHOLDER_EMAIL_SUFFIX2 = "@placeholder.local";
var ACCOUNT_COLUMNS = `id, user_id, email, tier, created_at, last_active_at`;
function toAccount(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at)
  };
}
__name(toAccount, "toAccount");
function isUniqueViolation(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNIQUE constraint failed");
}
__name(isUniqueViolation, "isUniqueViolation");
var D1AccountStore = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  static {
    __name(this, "D1AccountStore");
  }
  // -----------------------------------------------------------------------
  // Accounts
  // -----------------------------------------------------------------------
  /** Find an account row by external userId, or null. */
  async findByUserId(userId) {
    const row = await this.d1.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE user_id = ? LIMIT 1`).bind(userId).first();
    return row ? toAccount(row) : null;
  }
  /**
   * Find-or-create the account row for `userId`, safe against concurrent
   * callers racing the INSERT (ensureAccountRow parity): on a unique
   * violation the row already exists — re-read it instead of failing.
   */
  async ensureAccount(userId) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    try {
      await this.d1.prepare(
        `INSERT INTO accounts (user_id, email, tier) VALUES (?, ?, 'FREE')`
      ).bind(userId, `${userId}${PLACEHOLDER_EMAIL_SUFFIX2}`).run();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const raced = await this.findByUserId(userId);
    if (!raced) {
      throw new Error(`Account row for userId="${userId}" disappeared mid-create`);
    }
    return raced;
  }
  /**
   * Persist a verified email on the account row — the anonymous-upgrade
   * write that replaces the placeholder address (task 2.4 / FIX-E). Throws
   * when no account exists: a silent no-op would lose the verification.
   */
  async setVerifiedEmail(userId, email) {
    const result = await this.d1.prepare(`UPDATE accounts SET email = ? WHERE user_id = ?`).bind(email, userId).run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new Error(
        `Cannot set verified email: account not found for userId="${userId}"`
      );
    }
  }
  // -----------------------------------------------------------------------
  // Saved baskets
  // -----------------------------------------------------------------------
  /** The account's saved baskets, insertion order (repository parity). */
  async findBaskets(userId) {
    const rows = (await this.d1.prepare(
      `SELECT b.id, b.name, b.created_at, b.items
             FROM saved_baskets b
             JOIN accounts a ON a.id = b.account_id
            WHERE a.user_id = ?
            ORDER BY b.id ASC`
    ).bind(userId).all()).results;
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      createdAt: new Date(row.created_at),
      items: JSON.parse(row.items)
    }));
  }
  /** Insert a saved basket for the account. */
  async createBasket(userId, basket) {
    const account = await this.ensureAccount(userId);
    await this.d1.prepare(
      `INSERT INTO saved_baskets (account_id, name, items) VALUES (?, ?, ?)`
    ).bind(account.id, basket.name, JSON.stringify(basket.items)).run();
  }
  /** Delete a saved basket by id, scoped to the account. True when deleted. */
  async deleteBasket(userId, basketId) {
    const result = await this.d1.prepare(
      `DELETE FROM saved_baskets
          WHERE id = ?
            AND account_id = (SELECT id FROM accounts WHERE user_id = ?)`
    ).bind(Number.parseInt(basketId, 10), userId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
  // -----------------------------------------------------------------------
  // Saved scenarios
  // -----------------------------------------------------------------------
  /** The account's saved scenarios, newest activity first (repository order). */
  async findScenarios(userId) {
    const rows = (await this.d1.prepare(
      `SELECT s.id, s.name, s.inputs, s.created_at, s.updated_at
             FROM saved_scenarios s
             JOIN accounts a ON a.id = s.account_id
            WHERE a.user_id = ?
            ORDER BY s.updated_at DESC, s.id DESC`
    ).bind(userId).all()).results;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      inputs: JSON.parse(row.inputs),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
  }
  /**
   * Upsert-by-name: the (account, name) pair is the identity; inputs and
   * updatedAt refresh on replace. Returns the persisted scenario.
   */
  async upsertScenario(userId, name, inputs) {
    const account = await this.ensureAccount(userId);
    const row = await this.d1.prepare(
      `INSERT INTO saved_scenarios (account_id, name, inputs) VALUES (?, ?, ?)
          ON CONFLICT (account_id, name) DO UPDATE SET
            inputs = excluded.inputs,
            updated_at = excluded.updated_at
          RETURNING id, name, inputs, created_at, updated_at`
    ).bind(account.id, name, JSON.stringify(inputs)).first();
    if (!row) {
      throw new Error("saved_scenarios upsert returned no row");
    }
    return {
      id: row.id,
      name: row.name,
      inputs: JSON.parse(row.inputs),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
  /**
   * Delete scenario by id, scoped to the account. Account-scoped
   * semantics: a foreign or absent id is indistinguishable — false, never
   * a cross-account delete.
   */
  async deleteScenario(userId, scenarioId) {
    const result = await this.d1.prepare(
      `DELETE FROM saved_scenarios
          WHERE id = ?
            AND account_id = (SELECT id FROM accounts WHERE user_id = ?)`
    ).bind(scenarioId, userId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
  // -----------------------------------------------------------------------
  // Calculation history
  // -----------------------------------------------------------------------
  /**
   * Claim a calculation record for the account by stamping session_id —
   * first claim wins, so a cache-hit record id replayed to another session
   * never re-assigns ownership (linkSession parity).
   */
  async linkCalculation(recordId, userId) {
    const result = await this.d1.prepare(
      `UPDATE calculation_records SET session_id = ?
          WHERE id = ? AND (session_id IS NULL OR session_id = ?)`
    ).bind(userId, recordId, userId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
  /** IDs of the calculation records claimed by the account, chronological. */
  async findHistoryIds(userId) {
    const rows = (await this.d1.prepare(
      `SELECT id FROM calculation_records
            WHERE session_id = ? ORDER BY calculated_at ASC, id ASC`
    ).bind(userId).all()).results;
    return rows.map((row) => row.id);
  }
  /** Minimal export projection of the claimed records, chronological. */
  async findHistoryEntries(userId) {
    const rows = (await this.d1.prepare(
      `SELECT r.id, r.calculated_at, r.total_cents, r.quantity,
                  p.name AS product_name
             FROM calculation_records r
             JOIN product_master p ON p.id = r.product_master_id
            WHERE r.session_id = ?
            ORDER BY r.calculated_at ASC, r.id ASC`
    ).bind(userId).all()).results;
    return rows.map((row) => ({
      calculationId: row.id,
      calculatedAt: new Date(row.calculated_at),
      totalCents: row.total_cents,
      quantity: row.quantity,
      productName: row.product_name
    }));
  }
};
function newAnonymousUserId() {
  return crypto.randomUUID();
}
__name(newAnonymousUserId, "newAnonymousUserId");

// src/routes/accounts.routes.ts
var SESSION_COOKIE_NAME2 = "rajahinta_session";
var DEFAULT_SESSION_TTL_HOURS = 24 * 30;
function buildSessionCookie(token, expiresAt, env) {
  const expires = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const maxAgeSeconds = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1e3));
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME2}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}; Expires=${expires.toUTCString()}${secure}`;
}
__name(buildSessionCookie, "buildSessionCookie");
function buildSessionCookieClear(env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME2}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
__name(buildSessionCookieClear, "buildSessionCookieClear");
function sessionTtlMs(env) {
  const raw2 = env.SESSION_TTL_HOURS;
  if (raw2 === void 0 || raw2.trim() === "") return DEFAULT_SESSION_TTL_HOURS * 36e5;
  const parsed = Number.parseInt(raw2, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SESSION_TTL_HOURS * 36e5;
  return parsed * 36e5;
}
__name(sessionTtlMs, "sessionTtlMs");
function toBasketJson(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    items: row.items
  };
}
__name(toBasketJson, "toBasketJson");
function toScenarioJson(row) {
  return {
    id: row.id,
    name: row.name,
    inputs: row.inputs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
__name(toScenarioJson, "toScenarioJson");
function subscriptionOf(account) {
  return { userId: account.userId, plan: account.tier, active: true };
}
__name(subscriptionOf, "subscriptionOf");
async function issue(c) {
  const userId = newAnonymousUserId();
  const store = new D1AccountStore(c.env.DB);
  const account = await store.ensureAccount(userId);
  const token = opaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs(c.env));
  const sessions = new D1SessionRepository(c.env.DB);
  await sessions.create({
    tokenHash: await hashToken2(token),
    accountId: account.id,
    expiresAt
  });
  c.header("Set-Cookie", buildSessionCookie(token, expiresAt, c.env));
  return c.json({ userId, expiresAt: expiresAt.toISOString(), verified: false }, 201);
}
__name(issue, "issue");
async function rotate(c) {
  const user = c.get(USER_CONTEXT_KEY);
  const presented = c.get(SESSION_TOKEN_CONTEXT_KEY) ?? "";
  const newToken = opaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs(c.env));
  const sessions = new D1SessionRepository(c.env.DB);
  const session = await sessions.rotate(
    await hashToken2(presented),
    await hashToken2(newToken),
    expiresAt
  );
  if (session === null) {
    throw new ApiHttpError(401, {
      statusCode: 401,
      message: "Session token is invalid, expired, or revoked.",
      error: "InvalidSession"
    });
  }
  c.header("Set-Cookie", buildSessionCookie(newToken, session.expiresAt, c.env));
  return c.json({
    userId: user.userId,
    expiresAt: new Date(session.expiresAt).toISOString(),
    verified: user.verified
  });
}
__name(rotate, "rotate");
async function revoke(c) {
  const presented = c.get(SESSION_TOKEN_CONTEXT_KEY) ?? "";
  const sessions = new D1SessionRepository(c.env.DB);
  await sessions.revokeByTokenHash(await hashToken2(presented));
  c.header("Set-Cookie", buildSessionCookieClear(c.env));
  return c.json({ revoked: true });
}
__name(revoke, "revoke");
function requireUser(c) {
  return c.get(USER_CONTEXT_KEY);
}
__name(requireUser, "requireUser");
async function exportData(c) {
  const user = requireUser(c);
  const store = new D1AccountStore(c.env.DB);
  const account = await store.ensureAccount(user.userId);
  const savedBaskets = (await store.findBaskets(user.userId)).map(toBasketJson);
  const savedScenarios = (await store.findScenarios(user.userId)).map(toScenarioJson);
  const calculationHistory = (await store.findHistoryEntries(user.userId)).map((entry) => ({
    calculationId: entry.calculationId,
    timestamp: entry.calculatedAt.toISOString(),
    totalCents: entry.totalCents,
    productName: entry.productName,
    quantity: entry.quantity
  }));
  return c.json({
    userId: account.userId,
    exportDate: (/* @__PURE__ */ new Date()).toISOString(),
    account: {
      userId: account.userId,
      email: account.email,
      tier: account.tier,
      createdAt: account.createdAt.toISOString(),
      lastActiveAt: account.lastActiveAt.toISOString()
    },
    savedBaskets,
    savedScenarios,
    calculationHistory,
    subscription: subscriptionOf(account)
  });
}
__name(exportData, "exportData");
async function listBaskets(c) {
  const user = requireUser(c);
  const baskets = await new D1AccountStore(c.env.DB).findBaskets(user.userId);
  return c.json(baskets.map(toBasketJson));
}
__name(listBaskets, "listBaskets");
async function saveBasket(c) {
  const user = requireUser(c);
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiHttpError(400, "Request body must be JSON");
  }
  if (typeof body.name !== "string" || !Array.isArray(body.items)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: "name must be a string and items must be an array",
      error: "ValidationError"
    });
  }
  await new D1AccountStore(c.env.DB).createBasket(user.userId, {
    name: body.name,
    items: body.items
  });
  return c.body(null, 201);
}
__name(saveBasket, "saveBasket");
async function deleteBasket(c) {
  const user = requireUser(c);
  const basketId = parseUuidParam(c, "basketId");
  const deleted = await new D1AccountStore(c.env.DB).deleteBasket(user.userId, basketId);
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Basket "${basketId}" not found`,
      error: "BasketNotFound"
    });
  }
  return c.body(null, 200);
}
__name(deleteBasket, "deleteBasket");
async function getHistory(c) {
  const user = requireUser(c);
  const ids = await new D1AccountStore(c.env.DB).findHistoryIds(user.userId);
  return c.json(ids);
}
__name(getHistory, "getHistory");
var addHistorySchema = external_exports.object({
  recordId: external_exports.number({
    required_error: "recordId must be a positive integer",
    invalid_type_error: "recordId must be a positive integer"
  }).int("recordId must be a positive integer").positive("recordId must be a positive integer")
});
async function addHistory(c) {
  const user = requireUser(c);
  let raw2;
  try {
    raw2 = await c.req.json();
  } catch {
    raw2 = {};
  }
  const parsed = addHistorySchema.safeParse(raw2);
  if (!parsed.success) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: "recordId must be a positive integer",
      error: "InvalidRecordId"
    });
  }
  await new D1AccountStore(c.env.DB).linkCalculation(parsed.data.recordId, user.userId);
  return c.json({ success: true, recordId: parsed.data.recordId }, 201);
}
__name(addHistory, "addHistory");
async function getSubscription(c) {
  const user = requireUser(c);
  const account = await new D1AccountStore(c.env.DB).ensureAccount(user.userId);
  return c.json(subscriptionOf(account));
}
__name(getSubscription, "getSubscription");
async function verifyEmail(c) {
  const user = requireUser(c);
  let body;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  if (typeof body.email !== "string" || !isValidEmailFormat(body.email)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"email" is required and must be a valid email address',
      error: "InvalidEmail"
    });
  }
  await new D1AccountStore(c.env.DB).setVerifiedEmail(user.userId, body.email);
  return c.json({ verified: true, email: body.email });
}
__name(verifyEmail, "verifyEmail");
var TRANSPORT_ARRANGEMENTS = ["SELLER_ARRANGED", "INDEPENDENT_CARRIER", "PERSONAL"];
function validateScenarioBody(body) {
  const fail = /* @__PURE__ */ __name((message) => {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message,
      error: "InvalidScenarioRequest"
    });
  }, "fail");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Request body must be a JSON object with name and inputs");
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    fail("name must be a non-empty string");
  }
  const rawInputs = body.inputs;
  if (!rawInputs || typeof rawInputs !== "object" || Array.isArray(rawInputs)) {
    fail("inputs must be an object");
  }
  const inputs = rawInputs;
  const productId = inputs.productId;
  const quantity = inputs.quantity;
  const destination = inputs.destination;
  const transportMethod = inputs.transportMethod;
  const transportArrangement = inputs.transportArrangement;
  if (!Number.isInteger(productId) || productId <= 0) {
    fail("inputs.productId must be a positive integer");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    fail("inputs.quantity must be a positive integer");
  }
  if (typeof destination !== "string" || destination.trim().length === 0) {
    fail("inputs.destination must be a non-empty string");
  }
  if (transportMethod !== void 0 && (typeof transportMethod !== "string" || transportMethod.trim().length === 0)) {
    fail("inputs.transportMethod must be a non-empty string when provided");
  }
  if (transportArrangement !== void 0 && !TRANSPORT_ARRANGEMENTS.includes(transportArrangement)) {
    fail(
      "inputs.transportArrangement must be one of SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL when provided"
    );
  }
}
__name(validateScenarioBody, "validateScenarioBody");
async function listScenarios(c) {
  const user = requireUser(c);
  const scenarios = await new D1AccountStore(c.env.DB).findScenarios(user.userId);
  return c.json(scenarios.map(toScenarioJson));
}
__name(listScenarios, "listScenarios");
async function saveScenario(c) {
  const user = requireUser(c);
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiHttpError(400, "Request body must be JSON");
  }
  validateScenarioBody(body);
  const saved = await new D1AccountStore(c.env.DB).upsertScenario(
    user.userId,
    body.name,
    body.inputs
  );
  return c.json(toScenarioJson(saved), 201);
}
__name(saveScenario, "saveScenario");
async function deleteScenario(c) {
  const user = requireUser(c);
  const scenarioId = parseIntParam(c, "id");
  const deleted = await new D1AccountStore(c.env.DB).deleteScenario(user.userId, scenarioId);
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Scenario "${scenarioId}" not found`,
      error: "ScenarioNotFound"
    });
  }
  return c.body(null, 200);
}
__name(deleteScenario, "deleteScenario");
function opaqueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
__name(opaqueToken, "opaqueToken");
function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(base64UrlEncode, "base64UrlEncode");
async function hashToken2(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashToken2, "hashToken");
function registerAccountsRoutes(app2) {
  app2.post("/api/v1/account/session", requireRateLimit("DEFAULT"), issue);
  app2.on("POST", "/api/v1/account/session/rotate", requireRateLimit("DEFAULT"));
  app2.post("/api/v1/account/session/rotate", rotate);
  app2.delete("/api/v1/account/session", revoke);
  app2.get("/api/v1/account/export", exportData);
  app2.get("/api/v1/account/baskets", listBaskets);
  app2.post("/api/v1/account/baskets", saveBasket);
  app2.delete("/api/v1/account/baskets/:basketId", deleteBasket);
  app2.get("/api/v1/account/history", getHistory);
  app2.post("/api/v1/account/history", addHistory);
  app2.get("/api/v1/account/subscription", getSubscription);
  app2.post("/api/v1/account/verify-email", verifyEmail);
  app2.get("/api/v1/account/scenarios", listScenarios);
  app2.post("/api/v1/account/scenarios", saveScenario);
  app2.delete("/api/v1/account/scenarios/:id", deleteScenario);
  return app2;
}
__name(registerAccountsRoutes, "registerAccountsRoutes");

// src/routes/analytics.routes.ts
init_modules_watch_stub();
var FORBIDDEN_FIELDS = /* @__PURE__ */ new Set([
  "commission",
  "affiliate",
  "purchase",
  "transactionId",
  "orderId"
]);
async function click(c) {
  let body;
  try {
    const parsed = await c.req.json();
    body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    body = {};
  }
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: `Field "${key}" is not allowed in click analytics payload`,
        error: "ForbiddenField"
      });
    }
  }
  if (typeof body.merchantId !== "string" || body.merchantId.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"merchantId" is required and must be a non-empty string',
      error: "ValidationError"
    });
  }
  if (typeof body.url !== "string" || body.url.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: '"url" is required and must be a non-empty string',
      error: "ValidationError"
    });
  }
  await recordClick(c.env, body.merchantId, body.url);
  const counts = await getClickCounts(c.env);
  const merchantClicks = counts[body.merchantId];
  const count = merchantClicks?.[body.url] ?? 0;
  return c.json({ success: true, count });
}
__name(click, "click");
async function outbound(c) {
  const offerId = parseIntParam(c, "offerId");
  const offer = await new D1ProductSearchRepository(c.env.DB).findRetailOfferById(offerId);
  if (offer === null || !offer.sourceUrl) {
    throw new ApiHttpError(404, `Offer ${offerId} not found or has no source URL`);
  }
  void recordClick(c.env, offer.merchant, offer.sourceUrl);
  return c.redirect(offer.sourceUrl, 302);
}
__name(outbound, "outbound");
function registerAnalyticsRoutes(app2) {
  app2.post("/api/v1/analytics/click", click);
  app2.on("GET", "/api/v1/outbound/:offerId", requireRateLimit("DEFAULT"));
  app2.get("/api/v1/outbound/:offerId", outbound);
  return app2;
}
__name(registerAnalyticsRoutes, "registerAnalyticsRoutes");

// src/routes/ops.routes.ts
init_modules_watch_stub();

// src/adapters/audit.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/audit-event.repository.ts
init_modules_watch_stub();
var INSERT_SQL5 = `
  INSERT INTO audit_events (
    id, entity_type, entity_id, action, author, reason, occurred_at,
    previous_value, new_value
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
var D1AuditEventRepository = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  async save(entry) {
    await this.d1.prepare(INSERT_SQL5).bind(
      entry.id,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.author,
      entry.reason,
      // Domain carries ISO strings; the column is a canonical TEXT instant.
      new Date(entry.timestamp).toISOString(),
      entry.previousValue === void 0 ? null : JSON.stringify(entry.previousValue),
      entry.newValue === void 0 ? null : JSON.stringify(entry.newValue)
    ).run();
  }
  async query(params) {
    const conditions = [];
    const filterParams = [];
    if (params.entityType !== void 0) {
      conditions.push("entity_type = ?");
      filterParams.push(params.entityType);
    }
    if (params.entityId !== void 0) {
      conditions.push("entity_id = ?");
      filterParams.push(params.entityId);
    }
    if (params.action !== void 0) {
      conditions.push("action = ?");
      filterParams.push(params.action);
    }
    if (params.author !== void 0) {
      conditions.push("author = ?");
      filterParams.push(params.author);
    }
    if (params.fromDate !== void 0) {
      conditions.push("occurred_at >= ?");
      filterParams.push(new Date(params.fromDate).toISOString());
    }
    if (params.toDate !== void 0) {
      conditions.push("occurred_at <= ?");
      filterParams.push(new Date(params.toDate).toISOString());
    }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const sql = `
      SELECT id, entity_type, entity_id, action, author, reason, occurred_at,
             previous_value, new_value
        FROM audit_events${whereClause}
       ORDER BY occurred_at DESC, id ASC
       LIMIT ? OFFSET ?`;
    const rows = (await this.d1.prepare(sql).bind(
      ...filterParams,
      params.limit ?? Number.MAX_SAFE_INTEGER,
      params.offset ?? 0
    ).all()).results;
    return rows.map((row) => this.toEntry(row));
  }
  async getHistory(entityType, entityId) {
    return this.query({ entityType, entityId });
  }
  /** Row → domain entry; timestamp round-trips as an ISO string. */
  toEntry(row) {
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      author: row.author,
      reason: row.reason,
      // Stored canonical ISO-8601 TEXT — the pg toISOString() output.
      timestamp: row.occurred_at,
      ...row.previous_value !== null ? { previousValue: JSON.parse(row.previous_value) } : {},
      ...row.new_value !== null ? { newValue: JSON.parse(row.new_value) } : {}
    };
  }
};
__name(D1AuditEventRepository, "D1AuditEventRepository");
D1AuditEventRepository = __decorateClass([
  Injectable()
], D1AuditEventRepository);

// src/adapters/audit.ts
var WorkerAuditService = class {
  static {
    __name(this, "WorkerAuditService");
  }
  repo;
  constructor(d1) {
    this.repo = new D1AuditEventRepository(d1);
  }
  /**
   * Record a change — generates the id and timestamp so callers supply
   * only the semantic fields (AuditService.logChange parity).
   */
  async logChange(params) {
    const entry = {
      id: crypto.randomUUID(),
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      author: params.author,
      reason: params.reason,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...params.previousValue !== void 0 ? { previousValue: params.previousValue } : {},
      ...params.newValue !== void 0 ? { newValue: params.newValue } : {}
    };
    await this.repo.save(entry);
  }
  /** Filtered query, newest first (AuditService.queryChanges parity). */
  async queryChanges(params) {
    return this.repo.query(params);
  }
};

// ../../packages/data-platform/src/repositories/d1/fx-rate-port.adapter.ts
init_modules_watch_stub();
var D1FxRateDatasetRepositoryAdapter = class {
  constructor(repo) {
    this.repo = repo;
  }
  repo;
  /** @inheritdoc */
  async createDataset(input) {
    const record = await this.repo.createDataset(
      {
        versionLabel: input.versionLabel,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl ?? null,
        referenceDate: input.referenceDate,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        // Status is forced by the repository contract regardless of any
        // value set here — datasets never arrive effective (design D2).
        status: "PENDING_CONFIRMATION"
      },
      input.rates.map((rate) => ({
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: String(rate.rate)
      }))
    );
    return this.toVersion(record);
  }
  /** @inheritdoc */
  async findDatasetByVersionLabel(versionLabel) {
    const record = await this.repo.findDatasetByVersionLabel(versionLabel);
    return record === null ? null : this.toVersion(record);
  }
  /** @inheritdoc */
  async findDatasetById(id) {
    const record = await this.repo.findDatasetById(id);
    return record === null ? null : this.toVersion(record);
  }
  /** @inheritdoc */
  async findPendingDatasets() {
    const records = await this.repo.findPendingDatasets();
    return records.map((record) => this.toVersion(record));
  }
  /** @inheritdoc */
  async findPublishedDatasetEffectiveOn(asOf) {
    const record = await this.repo.findPublishedDatasetEffectiveOn(asOf);
    return record === null ? null : this.toVersion(record);
  }
  /** @inheritdoc */
  async publishDataset(id, confirmedBy) {
    const record = await this.repo.publishDataset(id, confirmedBy);
    return record === null ? null : this.toVersion(record);
  }
  /** @inheritdoc */
  async findRatesForDataset(datasetId) {
    const rows = await this.repo.findRatesForDataset(datasetId);
    return rows.map((row) => ({
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: fxRateTextToNumber(row.rate)
    }));
  }
  /** Persisted row → domain version (identity mapping, numeric-free). */
  toVersion(record) {
    return {
      id: record.id,
      versionLabel: record.versionLabel,
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      referenceDate: record.referenceDate,
      status: toDomainStatus(record.status),
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      confirmedBy: record.confirmedBy,
      confirmedAt: record.confirmedAt,
      createdAt: record.createdAt
    };
  }
};
__name(D1FxRateDatasetRepositoryAdapter, "D1FxRateDatasetRepositoryAdapter");
D1FxRateDatasetRepositoryAdapter = __decorateClass([
  Injectable()
], D1FxRateDatasetRepositoryAdapter);
function toDomainStatus(value) {
  if (!FX_DATASET_STATUSES.includes(value)) {
    throw new Error(
      `fx_rate_datasets.status "${value}" is not a known FX dataset lifecycle state`
    );
  }
  return value;
}
__name(toDomainStatus, "toDomainStatus");
function fxRateTextToNumber(rate) {
  const parsed = Number(rate);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Cannot parse fx_rates.rate as decimal: "${rate}"`);
  }
  return parsed;
}
__name(fxRateTextToNumber, "fxRateTextToNumber");

// ../../packages/data-platform/src/repositories/d1/fx-rate.repository.ts
init_modules_watch_stub();
var RATE_SCALE2 = 12;
function toContractDataset(row) {
  return {
    id: row.id,
    versionLabel: row.version_label,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    referenceDate: row.reference_date,
    status: row.status,
    effectiveFrom: new Date(row.effective_from),
    effectiveTo: row.effective_to === null ? null : new Date(row.effective_to),
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    createdAt: new Date(row.created_at)
  };
}
__name(toContractDataset, "toContractDataset");
var DATASET_COLUMNS = `
  id, version_label, source_name, source_url, reference_date, status,
  effective_from, effective_to, confirmed_by, confirmed_at, created_at`;
var RATE_COLUMNS = `
  id, dataset_id, base_currency, quote_currency, rate, created_at`;
var FIND_DATASET_BY_ID_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets WHERE id = ?`;
var FIND_DATASET_BY_LABEL_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets WHERE version_label = ?`;
var FIND_PENDING_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets
   WHERE status = 'PENDING_CONFIRMATION'
   ORDER BY created_at ASC`;
var FIND_PUBLISHED_EFFECTIVE_SQL = `
  SELECT ${DATASET_COLUMNS} FROM fx_rate_datasets
   WHERE status = 'PUBLISHED'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
   ORDER BY effective_from DESC
   LIMIT 1`;
var PUBLISH_SQL = `
  UPDATE fx_rate_datasets
     SET status = 'PUBLISHED', confirmed_by = ?, confirmed_at = ?
   WHERE id = ? AND status = 'PENDING_CONFIRMATION'
   RETURNING ${DATASET_COLUMNS}`;
var FIND_RATES_SQL = `
  SELECT ${RATE_COLUMNS} FROM fx_rates
   WHERE dataset_id = ?
   ORDER BY base_currency ASC, quote_currency ASC`;
var FIND_RATE_SQL = `
  SELECT ${RATE_COLUMNS} FROM fx_rates
   WHERE dataset_id = ? AND base_currency = ? AND quote_currency = ?
   LIMIT 1`;
var INSERT_DATASET_SQL = `
  INSERT INTO fx_rate_datasets (
    version_label, source_name, source_url, reference_date, status,
    effective_from, effective_to, confirmed_by, confirmed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
var INSERT_DATASET_WITH_ID_SQL = `
  INSERT INTO fx_rate_datasets (
    id, version_label, source_name, source_url, reference_date, status,
    effective_from, effective_to, confirmed_by, confirmed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
var INSERT_RATE_SQL = `
  INSERT INTO fx_rates (dataset_id, base_currency, quote_currency, rate)
  SELECT (SELECT id FROM fx_rate_datasets WHERE version_label = ?), ?, ?, ?`;
var D1FxRateRepository = class extends FxRateRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async createDataset(record, rates) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const datasetParams = [
      record.versionLabel,
      record.sourceName,
      record.sourceUrl ?? null,
      record.referenceDate,
      // New versions always start unconfirmed — never auto-published.
      record.status ?? "PENDING_CONFIRMATION",
      record.effectiveFrom.toISOString(),
      record.effectiveTo?.toISOString() ?? null,
      record.confirmedBy ?? null,
      record.confirmedAt?.toISOString() ?? null,
      record.createdAt?.toISOString() ?? now
    ];
    const datasetInsert = record.id === void 0 ? this.d1.prepare(INSERT_DATASET_SQL).bind(...datasetParams) : this.d1.prepare(INSERT_DATASET_WITH_ID_SQL).bind(record.id, ...datasetParams);
    const statements = [
      datasetInsert,
      ...rates.map(
        (rate) => this.d1.prepare(INSERT_RATE_SQL).bind(record.versionLabel, rate.baseCurrency, rate.quoteCurrency, rate.rate)
      )
    ];
    await this.d1.batch(statements);
    const row = await this.d1.prepare(FIND_DATASET_BY_LABEL_SQL).bind(record.versionLabel).first();
    if (!row) {
      throw new Error("fx_rate_datasets batch insert produced no dataset row");
    }
    return toContractDataset(row);
  }
  /** @inheritdoc */
  async findDatasetById(id) {
    const row = await this.d1.prepare(FIND_DATASET_BY_ID_SQL).bind(id).first();
    return row ? toContractDataset(row) : null;
  }
  /** @inheritdoc */
  async findDatasetByVersionLabel(versionLabel) {
    const row = await this.d1.prepare(FIND_DATASET_BY_LABEL_SQL).bind(versionLabel).first();
    return row ? toContractDataset(row) : null;
  }
  /** @inheritdoc */
  async findPendingDatasets() {
    const rows = (await this.d1.prepare(FIND_PENDING_SQL).all()).results;
    return rows.map(toContractDataset);
  }
  /** @inheritdoc */
  async findPublishedDatasetEffectiveOn(asOf) {
    const asOfText = asOf.toISOString();
    const row = await this.d1.prepare(FIND_PUBLISHED_EFFECTIVE_SQL).bind(asOfText, asOfText).first();
    return row ? toContractDataset(row) : null;
  }
  /** @inheritdoc */
  async publishDataset(id, confirmedBy) {
    const row = await this.d1.prepare(PUBLISH_SQL).bind(confirmedBy, (/* @__PURE__ */ new Date()).toISOString(), id).first();
    return row ? toContractDataset(row) : null;
  }
  /** @inheritdoc */
  async findRatesForDataset(datasetId) {
    const rows = (await this.d1.prepare(FIND_RATES_SQL).bind(datasetId).all()).results;
    return rows.map((row) => ({
      id: row.id,
      datasetId: row.dataset_id,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      // Contract shape: the pg numeric(24,12) decimal text.
      rate: row.rate.toFixed(RATE_SCALE2),
      createdAt: new Date(row.created_at)
    }));
  }
  /** @inheritdoc */
  async resolveRate(baseCurrency, quoteCurrency, asOf) {
    const dataset = await this.findPublishedDatasetEffectiveOn(asOf);
    if (!dataset) {
      return null;
    }
    const rate = await this.d1.prepare(FIND_RATE_SQL).bind(dataset.id, baseCurrency, quoteCurrency).first();
    if (!rate) {
      return null;
    }
    return {
      dataset,
      baseCurrency: rate.base_currency,
      quoteCurrency: rate.quote_currency,
      // D1 returns a REAL — no numeric-string coercion needed here.
      rate: rate.rate
    };
  }
};
__name(D1FxRateRepository, "D1FxRateRepository");
D1FxRateRepository = __decorateClass([
  Injectable()
], D1FxRateRepository);

// ../../packages/data-platform/src/repositories/d1/merchant-registry.repository.ts
init_modules_watch_stub();
function toContractRegistry(row) {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    country: row.country,
    feedUrl: row.feed_url,
    feedFormat: row.feed_format,
    pollingIntervalMs: row.polling_interval_ms,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}
__name(toContractRegistry, "toContractRegistry");
var REGISTRY_COLUMNS = `
  id, merchant_id, name, country, feed_url, feed_format,
  polling_interval_ms, created_at, updated_at`;
var LIST_SQL = `
  SELECT ${REGISTRY_COLUMNS} FROM merchant_registry ORDER BY merchant_id ASC`;
var FIND_BY_MERCHANT_ID_SQL = `
  SELECT ${REGISTRY_COLUMNS} FROM merchant_registry WHERE merchant_id = ?`;
var UPSERT_SQL2 = `
  INSERT INTO merchant_registry (
    merchant_id, name, country, feed_url, feed_format,
    polling_interval_ms, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (merchant_id) DO UPDATE SET
    name = excluded.name,
    country = excluded.country,
    feed_url = excluded.feed_url,
    feed_format = excluded.feed_format,
    polling_interval_ms = excluded.polling_interval_ms,
    updated_at = excluded.updated_at
  RETURNING ${REGISTRY_COLUMNS}`;
var D1MerchantRegistryRepository = class extends MerchantRegistryRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /** @inheritdoc */
  async list() {
    const rows = (await this.d1.prepare(LIST_SQL).all()).results;
    return rows.map(toContractRegistry);
  }
  /** @inheritdoc */
  async findByMerchantId(merchantId) {
    const row = await this.d1.prepare(FIND_BY_MERCHANT_ID_SQL).bind(merchantId).first();
    return row ? toContractRegistry(row) : null;
  }
  /** @inheritdoc */
  async upsert(record) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await this.d1.prepare(UPSERT_SQL2).bind(
      record.merchantId,
      record.name,
      record.country,
      record.feedUrl,
      record.feedFormat,
      record.pollingIntervalMs,
      record.createdAt?.toISOString() ?? now,
      // The conflict arm stamps the current instant — pg SET new Date().
      record.updatedAt?.toISOString() ?? now
    ).first();
    if (!row) {
      throw new Error("merchant_registry upsert .. RETURNING returned no row");
    }
    return toContractRegistry(row);
  }
};
__name(D1MerchantRegistryRepository, "D1MerchantRegistryRepository");
D1MerchantRegistryRepository = __decorateClass([
  Injectable()
], D1MerchantRegistryRepository);

// src/routes/ops.routes.ts
var ACQUISITION_METHODS = [
  "PERMITTED_FEED",
  "RETAILER_API",
  "STRUCTURED_MERCHANT_FEED",
  "LICENSED_PROVIDER",
  "COMPLIANT_CRAWLING",
  "MANUAL_VERIFICATION"
];
function validateOperator(dto) {
  if (typeof dto.operator !== "string" || dto.operator.trim() === "" || dto.operator.trim().length > 128) {
    throw new ApiHttpError(400, "operator must be a non-empty string (max 128 chars)");
  }
  if (dto.note !== void 0 && typeof dto.note !== "string") {
    throw new ApiHttpError(400, "note must be a string when provided");
  }
}
__name(validateOperator, "validateOperator");
async function readBody(c) {
  try {
    const parsed = await c.req.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new ApiHttpError(400, "Request body must be JSON");
  }
}
__name(readBody, "readBody");
async function listGovernance(c) {
  const merchants = await new D1MerchantRegistryRepository(c.env.DB).list();
  return c.json({
    items: merchants.map((merchant) => ({
      merchantId: merchant.merchantId,
      name: merchant.name,
      country: merchant.country,
      feedUrl: merchant.feedUrl,
      permissionStatus: "PENDING",
      sourceCount: 0,
      hasWarnings: false
    })),
    total: merchants.length
  });
}
__name(listGovernance, "listGovernance");
function governanceUnavailable() {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message: "Governance mutations are unavailable: the source-governance store has no D1 counterpart yet (no table was ported in migrate-to-cloudflare 2.5). Failing closed rather than writing to a non-durable store.",
    error: "StoreUnavailable"
  });
}
__name(governanceUnavailable, "governanceUnavailable");
async function grantGovernance(c) {
  const dto = await readBody(c);
  validateOperator(dto);
  if (!ACQUISITION_METHODS.includes(dto.acquisitionMethod)) {
    throw new ApiHttpError(
      400,
      `acquisitionMethod must be one of: ${ACQUISITION_METHODS.join(", ")}`
    );
  }
  if (typeof dto.sourceUrl !== "string" || dto.sourceUrl.trim() === "") {
    throw new ApiHttpError(400, "sourceUrl must be a non-empty string");
  }
  governanceUnavailable();
}
__name(grantGovernance, "grantGovernance");
async function revokeGovernance(c) {
  const dto = await readBody(c);
  validateOperator(dto);
  if (typeof dto.reason !== "string" || dto.reason.trim() === "") {
    throw new ApiHttpError(400, "reason is required for revocation");
  }
  governanceUnavailable();
}
__name(revokeGovernance, "revokeGovernance");
function fxService(env) {
  const repo = new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB));
  return { service: new FxRateDatasetService(repo), repo };
}
__name(fxService, "fxService");
async function listConfirmations(c) {
  const { service, repo } = fxService(c.env);
  const pending = await service.listPendingDatasets();
  const fx = [];
  for (const version of pending) {
    const rates = await repo.findRatesForDataset(version.id);
    fx.push({
      id: version.id,
      versionLabel: version.versionLabel,
      status: "PENDING_CONFIRMATION",
      sourceName: version.sourceName,
      sourceUrl: version.sourceUrl,
      referenceDate: version.referenceDate,
      effectiveFrom: version.effectiveFrom.toISOString(),
      effectiveTo: version.effectiveTo === null ? null : version.effectiveTo.toISOString(),
      rates: rates.map((rate) => ({
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: Number(rate.rate)
      }))
    });
  }
  return c.json({ fx, taxReviews: [] });
}
__name(listConfirmations, "listConfirmations");
async function confirmFx(c) {
  const id = parseIntParam(c, "id");
  const dto = await readBody(c);
  validateOperator(dto);
  const { service, repo } = fxService(c.env);
  const audit = new WorkerAuditService(c.env.DB);
  let predecessor = null;
  try {
    const published2 = await repo.findPublishedDatasetEffectiveOn(/* @__PURE__ */ new Date());
    predecessor = published2 ? { id: published2.id, versionLabel: published2.versionLabel } : null;
  } catch {
  }
  let published;
  try {
    published = await service.confirmPublication(id, dto.operator);
  } catch (err) {
    if (err instanceof Error && err.name === "FxDatasetNotFoundError") {
      throw new ApiHttpError(404, `FX dataset ${id} not found`);
    }
    if (err instanceof Error && err.name === "FxDatasetInvalidTransitionError") {
      throw new ApiHttpError(409, err.message);
    }
    throw err;
  }
  const invalidatedVersion = predecessor !== null && predecessor.id !== published.id ? predecessor.versionLabel : null;
  if (invalidatedVersion !== null) {
    await idempotencyInvalidateVersions(c.env, [invalidatedVersion]);
  }
  const confirmedAt = published.confirmedAt?.toISOString() ?? (/* @__PURE__ */ new Date()).toISOString();
  await audit.logChange({
    entityType: "fx_rate_dataset",
    entityId: published.versionLabel,
    action: "confirmed",
    author: dto.operator,
    reason: dto.note?.trim() || "FX dataset publication confirmed via operator console",
    previousValue: { status: "PENDING_CONFIRMATION", id: published.id },
    newValue: { status: "PUBLISHED", confirmedAt, invalidatedVersion }
  });
  return c.json({
    id: published.id,
    versionLabel: published.versionLabel,
    status: "PUBLISHED",
    confirmedAt,
    invalidatedVersion
  });
}
__name(confirmFx, "confirmFx");
function taxReviewsUnavailable() {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message: "Tax rate-review resolution is unavailable: the rate-review store has no D1 counterpart yet (migrate-to-cloudflare 2.5). Failing closed rather than fabricating a resolution.",
    error: "StoreUnavailable"
  });
}
__name(taxReviewsUnavailable, "taxReviewsUnavailable");
async function approveTaxReview(c) {
  const dto = await readBody(c);
  validateOperator(dto);
  taxReviewsUnavailable();
}
__name(approveTaxReview, "approveTaxReview");
async function rejectTaxReview(c) {
  const dto = await readBody(c);
  validateOperator(dto);
  taxReviewsUnavailable();
}
__name(rejectTaxReview, "rejectTaxReview");
function correctionsUnavailable() {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message: "The correction queue is unavailable: corrections have no D1 store yet (migrate-to-cloudflare 2.5). Failing closed rather than serving a queue that cannot persist.",
    error: "StoreUnavailable"
  });
}
__name(correctionsUnavailable, "correctionsUnavailable");
var createCorrectionSchema = external_exports.object({
  targetType: external_exports.enum(["calculation", "data_point"], {
    errorMap: /* @__PURE__ */ __name(() => ({ message: 'targetType must be "calculation" or "data_point"' }), "errorMap")
  }),
  targetId: external_exports.number({
    required_error: "targetId must be a positive integer",
    invalid_type_error: "targetId must be a positive integer"
  }).int("targetId must be a positive integer").positive("targetId must be a positive integer"),
  reason: external_exports.string({
    required_error: "reason must be a non-empty string",
    invalid_type_error: "reason must be a non-empty string"
  }).min(1, "reason must be a non-empty string"),
  operator: external_exports.string({
    required_error: "operator must be a non-empty string (max 128 chars)",
    invalid_type_error: "operator must be a non-empty string (max 128 chars)"
  }).min(1, "operator must be a non-empty string (max 128 chars)").max(128, "operator must be a non-empty string (max 128 chars)")
});
async function listCorrections(c) {
  void c;
  correctionsUnavailable();
}
__name(listCorrections, "listCorrections");
async function openCorrection(c) {
  const parsed = createCorrectionSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue2) => issue2.message).join("; ");
    throw new ApiHttpError(400, message);
  }
  correctionsUnavailable();
}
__name(openCorrection, "openCorrection");
async function resolveCorrection(c) {
  parseIntParam(c, "id");
  const dto = await readBody(c);
  validateOperator(dto);
  correctionsUnavailable();
}
__name(resolveCorrection, "resolveCorrection");
var MAX_LIMIT = 100;
var DEFAULT_LIMIT = 25;
async function recentAudit(c) {
  const raw2 = c.req.query("limit");
  const parsed = raw2 === void 0 ? void 0 : Number.parseInt(raw2, 10);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isInteger(parsed) ? parsed : DEFAULT_LIMIT)
  );
  const entries = await new WorkerAuditService(c.env.DB).queryChanges({ limit });
  return c.json({
    items: entries.map((entry) => ({
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      author: entry.author,
      reason: entry.reason,
      timestamp: entry.timestamp
    })),
    total: entries.length
  });
}
__name(recentAudit, "recentAudit");
function registerOpsRoutes(app2) {
  app2.get("/ops/console/governance", listGovernance);
  app2.post("/ops/console/governance/:merchantId/grant", grantGovernance);
  app2.post("/ops/console/governance/:merchantId/revoke", revokeGovernance);
  app2.get("/ops/console/confirmations", listConfirmations);
  app2.post("/ops/console/confirmations/fx/:id/confirm", confirmFx);
  app2.post("/ops/console/confirmations/tax/:id/approve", approveTaxReview);
  app2.post("/ops/console/confirmations/tax/:id/reject", rejectTaxReview);
  app2.get("/ops/console/corrections", listCorrections);
  app2.post("/ops/console/corrections", openCorrection);
  app2.post("/ops/console/corrections/:id/resolve", resolveCorrection);
  app2.get("/ops/console/audit", recentAudit);
  return app2;
}
__name(registerOpsRoutes, "registerOpsRoutes");

// src/cron/router.ts
init_modules_watch_stub();

// src/analytics/click-counter-flusher.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/click-counter-snapshot.repository.ts
init_modules_watch_stub();
var UPSERT_BATCH_SQL = `
  INSERT INTO click_counter_snapshots (merchant_id, url, click_count, captured_at)
  VALUES `;
var UPSERT_CONFLICT_SQL = `
  ON CONFLICT (merchant_id, url, captured_at) DO UPDATE SET
    click_count = excluded.click_count`;
var D1ClickCounterSnapshotRepository = class extends ClickCounterSnapshotRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /**
   * Upsert one batch of snapshot rows sharing a capture instant. Returns
   * the number of rows written — inserted or overwritten, exactly the
   * rows the pg RETURNING clause counted.
   */
  async appendBatch(rows) {
    if (rows.length === 0) {
      return 0;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const valuesClauses = [];
    const params = [];
    for (const row of rows) {
      valuesClauses.push("(?, ?, ?, COALESCE(?, ?))");
      params.push(
        row.merchantId,
        row.url,
        row.clickCount,
        row.capturedAt?.toISOString() ?? null,
        now
      );
    }
    const result = await this.d1.prepare(`${UPSERT_BATCH_SQL}${valuesClauses.join(", ")}${UPSERT_CONFLICT_SQL}`).bind(...params).run();
    const changes = result.meta.changes;
    if (typeof changes !== "number") {
      throw new Error("click_counter_snapshots batch upsert returned no change count");
    }
    return changes;
  }
};
__name(D1ClickCounterSnapshotRepository, "D1ClickCounterSnapshotRepository");
D1ClickCounterSnapshotRepository = __decorateClass([
  Injectable()
], D1ClickCounterSnapshotRepository);

// src/analytics/click-counter-flusher.ts
async function flushClickCounters(env) {
  const snapshot = await drainClickCounter(env);
  if (!snapshot || snapshot.rows.length === 0) {
    return { snapshotTaken: false, rowsWritten: 0 };
  }
  const repository = new D1ClickCounterSnapshotRepository(env.DB);
  const rowsWritten = await repository.appendBatch(
    snapshot.rows.map((row) => ({
      merchantId: row.merchantId,
      url: row.url,
      clickCount: row.clickCount,
      capturedAt: new Date(snapshot.capturedAt)
    }))
  );
  return { snapshotTaken: true, rowsWritten };
}
__name(flushClickCounters, "flushClickCounters");

// src/cron/transport-rate-refresh.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/abstract/transport-rate.service.ts
init_modules_watch_stub();
var TransportRateService = class {
};
__name(TransportRateService, "TransportRateService");
TransportRateService = __decorateClass([
  Injectable()
], TransportRateService);

// ../../packages/data-acquisition/src/interfaces/carrier-rate-source.port.ts
init_modules_watch_stub();
var CARRIER_RATE_SOURCES_TOKEN = "CARRIER_RATE_SOURCES";
var POSTI_RATE_FEED_URL = "https://www.posti.fi/api/price-list/parcels.json";

// ../../packages/data-acquisition/src/interfaces/transport-offer-write.port.ts
init_modules_watch_stub();
var TRANSPORT_OFFER_WRITE_PORT = "TRANSPORT_OFFER_WRITE_PORT";

// ../../packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter.ts
var ALL_CARRIERS = "*";
var PipelineTransportRateAdapter = class extends TransportRateService {
  constructor(governanceService, rateSources, offerWritePort) {
    super();
    this.governanceService = governanceService;
    this.rateSources = rateSources;
    this.offerWritePort = offerWritePort;
  }
  governanceService;
  rateSources;
  offerWritePort;
  logger = new Logger(PipelineTransportRateAdapter.name);
  /**
   * Refresh transport rates for one carrier (or all registered carriers
   * with the `*` wildcard).
   *
   * Governance gate first, per carrier: no permission records, a
   * governance outage, or any status other than GRANTED skips the
   * carrier — default-off, exactly like merchant ingestion.
   */
  async refreshCarrierRates(carrierId) {
    const carriers = carrierId === ALL_CARRIERS ? [...this.rateSources.keys()] : [carrierId];
    const known = carriers.filter((id) => {
      if (this.rateSources.has(id)) return true;
      this.logger.warn(`No rate source registered for carrier "${id}" \u2014 skipping`);
      return false;
    });
    let ratesUpdated = 0;
    for (const carrier of known) {
      ratesUpdated += await this.refreshSingleCarrier(carrier);
    }
    const newestOfferObservedAt = await this.offerWritePort.findNewestObservedAt();
    return { ratesUpdated, newestOfferObservedAt };
  }
  /**
   * Schedule periodic transport-rate refreshes.
   *
   * Still a no-op — scheduling is owned by the BullMQ
   * transport-rate-refresh job (see jobs-scheduler.service.ts).
   */
  schedulePeriodicRefresh(_intervalMs) {
    this.logger.log(
      "schedulePeriodicRefresh: scheduling is managed by BullMQ (transport-refresh queue)"
    );
  }
  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  async refreshSingleCarrier(carrierId) {
    const permitted = await this.checkCarrierPermission(carrierId);
    if (!permitted) {
      return 0;
    }
    const source = this.rateSources.get(carrierId);
    const { rates, errors } = await source.fetchRates();
    if (errors.length > 0) {
      this.logger.warn(
        `Carrier "${carrierId}" rate fetch reported ${errors.length} error(s): ${errors.join("; ")}`
      );
    }
    if (rates.length === 0) {
      this.logger.warn(`Carrier "${carrierId}" returned no valid rates \u2014 nothing appended`);
      return 0;
    }
    const { inserted } = await this.offerWritePort.insertOffers(
      rates.map((rate) => ({ rate, reliabilityStatus: "VERIFIED" }))
    );
    this.logger.log(
      `Appended ${inserted} transport offers for carrier "${carrierId}" (observed ${rates[0].observedAt.toISOString()})`
    );
    return inserted;
  }
  /**
   * Governance gate for a carrier — mirrors the price pipeline's
   * checkMerchantPermission: no records or a governance error default
   * to PENDING (off), never to granted.
   */
  async checkCarrierPermission(carrierId) {
    let result;
    try {
      result = await this.governanceService.checkPermission(carrierId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown governance error";
      this.logger.error(
        `Governance check failed for carrier "${carrierId}": ${message} \u2014 defaulting to PENDING`
      );
      return false;
    }
    if (result.sources.length === 0) {
      this.logger.warn(
        `Skipping carrier "${carrierId}": no governance records found \u2014 defaulting to PENDING`
      );
      return false;
    }
    if (result.permissionStatus !== "GRANTED") {
      this.logger.warn(
        `Skipping carrier "${carrierId}": permission status is ${result.permissionStatus}`
      );
      return false;
    }
    return true;
  }
};
__name(PipelineTransportRateAdapter, "PipelineTransportRateAdapter");
PipelineTransportRateAdapter = __decorateClass([
  Injectable(),
  __decorateParam(1, Inject(CARRIER_RATE_SOURCES_TOKEN)),
  __decorateParam(2, Inject(TRANSPORT_OFFER_WRITE_PORT))
], PipelineTransportRateAdapter);

// ../../packages/data-acquisition/src/adapters/posti-rate.source.ts
init_modules_watch_stub();
var SUPPORTED_CURRENCY = "EUR";
var PACKAGE_TIERS = /* @__PURE__ */ new Set(["parcel", "box", "pallet"]);
function readNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
__name(readNonEmptyString, "readNonEmptyString");
function readCountry(value) {
  const raw2 = readNonEmptyString(value);
  if (raw2 === null) return null;
  const upper = raw2.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}
__name(readCountry, "readCountry");
function readWeight(value) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return -1;
  return value;
}
__name(readWeight, "readWeight");
function readPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
__name(readPrice, "readPrice");
function parsePostiRates(payload) {
  const rates = [];
  const errors = [];
  if (typeof payload !== "object" || payload === null) {
    return { rates, errors: ["Posti payload is not a JSON object"] };
  }
  const list = payload;
  const source = readNonEmptyString(list.source);
  if (source === null || source.toLowerCase() !== "posti") {
    errors.push(`Unexpected payload source "${String(list.source)}" \u2014 expected "posti"`);
    return { rates, errors };
  }
  const currency = readNonEmptyString(list.currency);
  if (currency === null || currency.toUpperCase() !== SUPPORTED_CURRENCY) {
    errors.push(
      `Posti price list currency "${String(list.currency)}" is not ${SUPPORTED_CURRENCY}; non-EUR carrier rates require FX conversion at ingestion (task 1.4) and are rejected here`
    );
    return { rates, errors };
  }
  const publishedAtRaw = readNonEmptyString(list.publishedAt);
  const publishedMs = publishedAtRaw !== null ? Date.parse(publishedAtRaw) : NaN;
  if (publishedAtRaw === null || Number.isNaN(publishedMs)) {
    errors.push("Posti payload lacks a valid publishedAt timestamp \u2014 observation time is unknowable");
    return { rates, errors };
  }
  const observedAt = new Date(publishedMs);
  if (!Array.isArray(list.products)) {
    errors.push("Posti payload has no products array");
    return { rates, errors };
  }
  const rows = list.products;
  rows.forEach((row, index) => {
    const label = `products[${index}] (${String(row.productCode ?? "unnamed")})`;
    const origin = readCountry(row.originCountry);
    const destination = readCountry(row.destinationCountry);
    if (origin === null || destination === null) {
      errors.push(`${label}: invalid lane ${String(row.originCountry)}\u2192${String(row.destinationCountry)}`);
      return;
    }
    const packageTier = readNonEmptyString(row.packageTier)?.toLowerCase() ?? null;
    if (packageTier === null || !PACKAGE_TIERS.has(packageTier)) {
      errors.push(`${label}: unknown package tier "${String(row.packageTier)}"`);
      return;
    }
    const bracket = row.weightBracket ?? {};
    const minKg = readWeight(bracket.minKg);
    const maxKg = readWeight(bracket.maxKg);
    if (minKg === -1 || maxKg === -1) {
      errors.push(`${label}: invalid weight bracket`);
      return;
    }
    if (minKg !== null && maxKg !== null && maxKg <= minKg) {
      errors.push(`${label}: weight bracket max \u2264 min`);
      return;
    }
    const priceCents = readPrice(row.priceIncludingVat);
    if (priceCents === null) {
      errors.push(`${label}: invalid price "${String(row.priceIncludingVat)}"`);
      return;
    }
    rates.push({
      carrier: "posti",
      originCountry: origin,
      destinationCountry: destination,
      weightMinKg: minKg,
      weightMaxKg: maxKg,
      packageTier,
      priceCents,
      currency: SUPPORTED_CURRENCY,
      sellerInvolvementIndicator: row.sellerTransportPaid === true,
      observedAt
    });
  });
  return { rates, errors };
}
__name(parsePostiRates, "parsePostiRates");
var jsonFetcher = /* @__PURE__ */ __name(async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}, "jsonFetcher");
var PostiCarrierRateSource = class {
  constructor(fetcher = jsonFetcher, feedUrl = POSTI_RATE_FEED_URL) {
    this.fetcher = fetcher;
    this.feedUrl = feedUrl;
  }
  fetcher;
  feedUrl;
  carrierId = "posti";
  async fetchRates() {
    try {
      const payload = await this.fetcher(this.feedUrl);
      return parsePostiRates(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { rates: [], errors: [`Posti fetch failed: ${message}`] };
    }
  }
};
__name(PostiCarrierRateSource, "PostiCarrierRateSource");
PostiCarrierRateSource = __decorateClass([
  Injectable(),
  __decorateParam(0, Optional()),
  __decorateParam(1, Optional())
], PostiCarrierRateSource);

// src/queues/pipeline.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/content/content-lint.service.ts
init_modules_watch_stub();
var BANNED_PATTERNS = [
  // Finnish
  { pattern: "paras", language: "fi", isPhrase: false },
  { pattern: "edullisin", language: "fi", isPhrase: false },
  { pattern: "laadukas", language: "fi", isPhrase: false },
  { pattern: "ensiluokkainen", language: "fi", isPhrase: false },
  { pattern: "ainutlaatuinen", language: "fi", isPhrase: false },
  { pattern: "t\xE4ydellinen", language: "fi", isPhrase: false },
  { pattern: "haitaton", language: "fi", isPhrase: false },
  { pattern: "turvallisin", language: "fi", isPhrase: false },
  // English
  { pattern: "best", language: "en", isPhrase: false },
  { pattern: "cheapest", language: "en", isPhrase: false },
  { pattern: "highest quality", language: "en", isPhrase: true },
  { pattern: "premium", language: "en", isPhrase: false },
  { pattern: "exclusive", language: "en", isPhrase: false },
  { pattern: "perfect", language: "en", isPhrase: false },
  { pattern: "guaranteed", language: "en", isPhrase: false },
  // Swedish
  { pattern: "b\xE4sta", language: "sv", isPhrase: false },
  { pattern: "billigast", language: "sv", isPhrase: false },
  { pattern: "h\xF6gsta kvalitet", language: "sv", isPhrase: true },
  { pattern: "exklusiv", language: "sv", isPhrase: false },
  { pattern: "perfekt", language: "sv", isPhrase: false }
];
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegex, "escapeRegex");
function scanField(text, field) {
  const violations = [];
  for (const entry of BANNED_PATTERNS) {
    const escaped = escapeRegex(entry.pattern);
    const regex = entry.isPhrase ? new RegExp(escaped, "gi") : new RegExp(`\\b${escaped}\\b`, "gi");
    let match2;
    while ((match2 = regex.exec(text)) !== null) {
      violations.push({
        pattern: entry.pattern,
        field,
        language: entry.language,
        matchedText: match2[0]
      });
    }
  }
  return violations;
}
__name(scanField, "scanField");
var ContentLintService = class {
  /**
   * Lint a product's name and description for content-policy violations.
   *
   * Both fields are checked against the full banned vocabulary.  The service
   * never mutates data and never throws — violations are collected into the
   * returned result for the caller to handle.
   *
   * @example
   * ```ts
   * const result = service.lintProductContent('Paras olut', 'Premium laatu');
   * // result.violations.length === 2
   * ```
   */
  lintProductContent(name, description) {
    const violations = [
      ...scanField(name, "name"),
      ...scanField(description, "description")
    ];
    return { violations };
  }
};
__name(ContentLintService, "ContentLintService");
ContentLintService = __decorateClass([
  Injectable()
], ContentLintService);

// ../../packages/data-acquisition/src/services/data-mapping.service.ts
init_modules_watch_stub();
var DataMappingService = class {
  /**
   * Map a single raw feed record to upsert-ready product + offer inputs.
   *
   * @param record     Normalised feed record from the merchant adapter
   *                   (currency already converted to EUR at ingestion,
   *                   task 1.4 — the original amount stays on the record
   *                   for display consumers).
   * @param merchantId Merchant identifier to stamp on the retail offer.
   * @param country    Merchant market (ISO 3166-1 alpha-2) from the
   *                   merchant registry row driving this run — what the
   *                   offer's country field records. Optional only for
   *                   backward compatibility with direct unit callers;
   *                   the pipeline always passes it.
   */
  mapToProductAndOffer(record, merchantId, country) {
    const product = {
      id: 0,
      // placeholder; the upsert adapter resolves the canonical ID
      name: record.productName,
      manufacturer: record.brand,
      // placeholder — feed adapter may provide actual manufacturer
      brand: record.brand,
      category: record.category,
      containerType: record.containerType,
      unitVolume: String(record.volumeMl),
      alcoholByVolume: record.alcoholByVolume !== null ? String(record.alcoholByVolume) : null,
      ean: record.ean,
      regulatoryClassification: record.regulatoryClassification,
      depositSystemStatus: false
    };
    const offerInput = {
      merchant: merchantId,
      // Registry-backed merchant market; the Finnish market default
      // matches the schema's own documented default for direct callers.
      country: country ?? "FI",
      priceCents: record.priceCents,
      currency: record.currency,
      // Conversion provenance (task 1.4, design D2): the original
      // amount/currency stay next to the converted EUR cents, and the
      // FX dataset version records which governed dataset produced them.
      originalPriceCents: record.originalPriceCents,
      originalCurrency: record.originalCurrency,
      fxDatasetVersion: record.fxDatasetVersion ?? null,
      availability: "in_stock",
      sourceUrl: record.sourceUrl,
      observedAt: /* @__PURE__ */ new Date(),
      reliabilityStatus: "ESTIMATED"
    };
    return { product, offerInput };
  }
  /**
   * Map a batch of raw feed records.
   */
  mapBatch(records, merchantId, country) {
    return records.map((r) => this.mapToProductAndOffer(r, merchantId, country));
  }
};
__name(DataMappingService, "DataMappingService");
DataMappingService = __decorateClass([
  Injectable()
], DataMappingService);

// ../../packages/data-acquisition/src/services/data-quality.service.ts
init_modules_watch_stub();
var DataQualityService = class {
  constructor(reliability) {
    this.reliability = reliability;
  }
  reliability;
  logger = new Logger(DataQualityService.name);
  /** Register (or clear) the report receiver — see {@link QualityReportHook}. */
  static setQualityReportHook(hook) {
    DataQualityService.qualityReportHook = hook;
  }
  /**
   * Assess whether an offer's observation timestamp is fresh enough for
   * the given domain.
   *
   * @param offer   Object with an `observedAt` timestamp (structural subtype
   *                of both RetailOfferRecord and TransportOfferRecord).
   * @param domain  Domain identifier — determines the staleness threshold.
   * @returns       `VERIFIED` when the data is within threshold,
   *                `STALE` when the threshold has been exceeded.
   */
  checkOfferFreshness(offer, domain) {
    const threshold = this.reliability.stalenessThresholdFor(domain);
    return this.reliability.assessDataRecency(offer.observedAt, threshold);
  }
  /**
   * Run a full quality check over a batch of offers.
   *
   * For each offer the method:
   *   1. Determines the actual recency status via `checkOfferFreshness`.
   *   2. Counts VERIFIED / STALE / UNAVAILABLE / ESTIMATED.
   *   3. Flags offers whose stored `reliabilityStatus` claims VERIFIED
   *      but whose actual status is STALE or UNAVAILABLE.
   *
   * @param offers  Offers to audit (lightweight objects from the pipeline
   *                or full RetailOfferRecord values — both are structurally
   *                compatible with {@link QualityCheckOffer}).
   * @returns       An actionable quality report.
   */
  runQualityCheck(offers) {
    const report = {
      totalOffers: offers.length,
      staleCount: 0,
      unavailableCount: 0,
      estimatedCount: 0,
      verifiedCount: 0,
      flaggedIssues: []
    };
    for (const offer of offers) {
      const actualStatus = this.checkOfferFreshness(offer, "price");
      const storedStatus = offer.reliabilityStatus;
      if (actualStatus === "VERIFIED") report.verifiedCount++;
      else if (actualStatus === "STALE") report.staleCount++;
      else if (actualStatus === "UNAVAILABLE") report.unavailableCount++;
      else if (actualStatus === "ESTIMATED") report.estimatedCount++;
      if (!this.verifyNoSilentVerified(storedStatus, actualStatus)) {
        const identifier = `merchant="${offer.merchant}" productId=${offer.productId}`;
        report.flaggedIssues.push(
          `Offer ${identifier} has stored reliabilityStatus "${storedStatus}" but is actually "${actualStatus}" (observedAt=${offer.observedAt.toISOString()})`
        );
      }
    }
    this.logger.log(
      `Quality check: ${report.totalOffers} offers, ${report.verifiedCount} verified, ${report.staleCount} stale, ${report.estimatedCount} estimated, ${report.unavailableCount} unavailable, ${report.flaggedIssues.length} issues flagged`
    );
    DataQualityService.qualityReportHook?.(report);
    return report;
  }
  /**
   * Verify that STALE / UNAVAILABLE data is never silently presented as
   * VERIFIED.
   *
   * @param reliabilityStatus  What the data was recorded as (e.g. the stored
   *                           `reliabilityStatus` column value).
   * @param actualStatus       What the actual status should be based on
   *                           recency and availability checks.
   * @returns                  `true` when the stored classification is valid
   *                           (no silent VERIFIED), `false` when data claimed
   *                           as VERIFIED should actually be STALE or
   *                           UNAVAILABLE.
   */
  verifyNoSilentVerified(reliabilityStatus, actualStatus) {
    if (reliabilityStatus === "VERIFIED" && actualStatus !== "VERIFIED") {
      return false;
    }
    return true;
  }
};
__name(DataQualityService, "DataQualityService");
/**
 * Static because data-acquisition sits below application-api in the
 * layer graph — the exporter there cannot inject a token this package
 * does not export from its index. Set once at composition time by
 * PrometheusMetricsService; unbound hosts (tests, stand-alone usage)
 * run unchanged.
 */
__publicField(DataQualityService, "qualityReportHook", null);
DataQualityService = __decorateClass([
  Injectable()
], DataQualityService);

// ../../packages/data-acquisition/src/services/feed-ingestion.service.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/interfaces/feed-adapter.interface.ts
init_modules_watch_stub();
var FEED_ADAPTERS_TOKEN = "FEED_ADAPTERS";

// ../../packages/data-acquisition/src/services/feed-ingestion.service.ts
var FeedIngestionService = class {
  constructor(adapters) {
    this.adapters = adapters;
  }
  adapters;
  /**
   * Fetch product data from a merchant's feed via its registered adapter.
   *
   * @param merchantId  Stable merchant identifier.
   * @param feedUrl     The feed or API endpoint URL.
   * @param feedFormat  Expected payload format.
   * @returns           Normalised records plus any per-record errors.
   */
  async fetchFromMerchant(merchantId, feedUrl, feedFormat) {
    const adapter = this.adapters.get(merchantId);
    if (!adapter) {
      return {
        productsIngested: 0,
        errors: [`No feed adapter registered for merchant "${merchantId}"`],
        records: []
      };
    }
    try {
      const result = await adapter.fetch({ feedUrl, feedFormat });
      return {
        productsIngested: result.records.length,
        errors: result.errors,
        records: result.records
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown fetch error";
      return {
        productsIngested: 0,
        errors: [`Feed adapter "${merchantId}" threw: ${message}`],
        records: []
      };
    }
  }
};
__name(FeedIngestionService, "FeedIngestionService");
FeedIngestionService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(FEED_ADAPTERS_TOKEN))
], FeedIngestionService);

// ../../packages/data-acquisition/src/services/pipeline-orchestrator.service.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/interfaces/upsert-port.interface.ts
init_modules_watch_stub();
var UPSERT_REPOSITORY_TOKEN = "UPSERT_REPOSITORY";

// ../../packages/data-acquisition/src/interfaces/offer-change-hook.interface.ts
init_modules_watch_stub();
var OFFER_CHANGE_HOOK_TOKEN = "OFFER_CHANGE_HOOK";

// ../../packages/data-acquisition/src/services/pipeline-orchestrator.service.ts
var PipelineOrchestratorService = class {
  constructor(feedIngestion, dataMapping, dataQuality, upsertRepository, governanceService, contentLint, offerChangeHook) {
    this.feedIngestion = feedIngestion;
    this.dataMapping = dataMapping;
    this.dataQuality = dataQuality;
    this.upsertRepository = upsertRepository;
    this.governanceService = governanceService;
    this.contentLint = contentLint;
    this.offerChangeHook = offerChangeHook;
  }
  feedIngestion;
  dataMapping;
  dataQuality;
  upsertRepository;
  governanceService;
  contentLint;
  offerChangeHook;
  logger = new Logger(PipelineOrchestratorService.name);
  /**
   * Run the full ingestion pipeline for a single merchant.
   *
   * Before fetching any data the governance gate is checked.  Merchants
   * without GRANTED permission status are skipped with a gate-failure
   * report.  Merchants with an empty `feedUrl` are also skipped as a
   * technical prerequisite (no adapter implementation yet).
   */
  async runForMerchant(config) {
    const start = Date.now();
    if (!config.feedUrl) {
      this.logger.warn(
        `Skipping merchant "${config.merchantId}": no feed URL`
      );
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: [],
        durationMs: Date.now() - start,
        contentViolations: []
      };
    }
    const gateResult = await this.checkMerchantPermission(config.merchantId);
    if (!gateResult.permitted) {
      this.logger.warn(
        `Skipping merchant "${config.merchantId}": ${gateResult.reason}`
      );
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: [],
        durationMs: Date.now() - start,
        gateResult,
        contentViolations: []
      };
    }
    const fetchResult = await this.feedIngestion.fetchFromMerchant(
      config.merchantId,
      config.feedUrl,
      config.feedFormat
    );
    if (fetchResult.errors.length > 0) {
      this.logger.warn(
        `Fetch warnings/errors for "${config.merchantId}": ${fetchResult.errors.join("; ")}`
      );
    }
    if (fetchResult.records.length === 0) {
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: fetchResult.errors,
        durationMs: Date.now() - start,
        contentViolations: []
      };
    }
    const mapped = this.dataMapping.mapBatch(
      fetchResult.records,
      config.merchantId,
      config.country
    );
    const contentViolations = [];
    for (const pair of mapped) {
      const result = this.contentLint.lintProductContent(
        pair.product.name,
        ""
        // description — not available in Phase 1 feed data
      );
      contentViolations.push(...result.violations);
    }
    if (contentViolations.length > 0) {
      this.logger.warn(
        `Content violations for "${config.merchantId}": ${contentViolations.length} found`
      );
    }
    let recordsAdded = 0;
    let recordsUpdated = 0;
    let offersChanged = 0;
    const upsertErrors = [];
    const upsertedOffers = [];
    for (const pair of mapped) {
      try {
        const upsertResult = await this.upsertRepository.upsertProduct(
          pair.product
        );
        if (upsertResult.created) {
          recordsAdded++;
        } else {
          recordsUpdated++;
        }
        const offerResult = await this.upsertRepository.upsertOffer({
          ...pair.offerInput,
          productId: upsertResult.productId
        });
        upsertedOffers.push({
          merchant: config.merchantId,
          productId: upsertResult.productId,
          observedAt: pair.offerInput.observedAt,
          reliabilityStatus: pair.offerInput.reliabilityStatus
        });
        if (offerResult.changed) {
          offersChanged++;
          if (this.offerChangeHook) {
            try {
              await this.offerChangeHook.onOfferChanged({
                productId: upsertResult.productId,
                offerId: offerResult.offerId,
                merchant: config.merchantId,
                country: pair.offerInput.country,
                priceCents: pair.offerInput.priceCents,
                reliabilityStatus: pair.offerInput.reliabilityStatus,
                observedAt: pair.offerInput.observedAt
              });
            } catch (hookErr) {
              const message = hookErr instanceof Error ? hookErr.message : "Unknown offer-change hook error";
              this.logger.error(
                `Offer-change hook failed for offer ${offerResult.offerId} (merchant "${config.merchantId}", product ${upsertResult.productId}); observation not recorded, ingestion continues: ${message}`
              );
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown upsert error";
        upsertErrors.push(
          `Failed to upsert product "${pair.product.name}": ${message}`
        );
      }
    }
    let qualityReport;
    if (upsertedOffers.length > 0) {
      qualityReport = this.dataQuality.runQualityCheck(upsertedOffers);
    }
    const durationMs = Date.now() - start;
    const allErrors = [...fetchResult.errors, ...upsertErrors];
    const logParts = [
      `Pipeline run for "${config.merchantId}": `,
      `${fetchResult.records.length} fetched, `,
      `${recordsAdded} added, ${recordsUpdated} updated, `,
      `${offersChanged} offers changed, `,
      `${allErrors.length} errors, ${durationMs} ms`
    ];
    if (contentViolations.length > 0) {
      logParts.push(`, ${contentViolations.length} content violations`);
    }
    if (qualityReport && qualityReport.flaggedIssues.length > 0) {
      logParts.push(
        `, ${qualityReport.flaggedIssues.length} quality issues`
      );
    }
    this.logger.log(logParts.join(""));
    return {
      merchantId: config.merchantId,
      recordsFetched: fetchResult.records.length,
      recordsAdded,
      recordsUpdated,
      offersChanged,
      errors: allErrors,
      durationMs,
      qualityReport,
      contentViolations
    };
  }
  /**
   * Run the pipeline for all merchants.
   *
   * Each merchant's config is passed through the governance gate
   * individually — some may be skipped while others are ingested.
   */
  async runAll(configs) {
    const results = [];
    for (const config of configs) {
      const report = await this.runForMerchant(config);
      results.push(report);
    }
    return results;
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /**
   * Check whether the merchant has permission to be ingested.
   *
   * Returns a {@link PermissionGateResult} indicating the resolved status.
   * Merchants with no governance records are treated as PENDING (off).
   * Governance service errors are caught and reported as PENDING so a
   * repository outage does not accidentally grant access.
   */
  async checkMerchantPermission(merchantId) {
    let result;
    try {
      result = await this.governanceService.checkPermission(merchantId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown governance error";
      this.logger.error(
        `Governance check failed for merchant "${merchantId}": ${message}`
      );
      return {
        permitted: false,
        status: "PENDING",
        reason: "Governance check error \u2014 defaulting to PENDING"
      };
    }
    if (result.sources.length === 0) {
      return {
        permitted: false,
        status: "PENDING",
        reason: "No governance records found \u2014 defaulting to PENDING"
      };
    }
    if (result.permissionStatus === "GRANTED") {
      return {
        permitted: true,
        status: "GRANTED",
        reason: "Permission granted"
      };
    }
    return {
      permitted: false,
      status: result.permissionStatus,
      reason: `Permission status is ${result.permissionStatus}`
    };
  }
};
__name(PipelineOrchestratorService, "PipelineOrchestratorService");
PipelineOrchestratorService = __decorateClass([
  Injectable(),
  __decorateParam(3, Inject(UPSERT_REPOSITORY_TOKEN)),
  __decorateParam(6, Optional()),
  __decorateParam(6, Inject(OFFER_CHANGE_HOOK_TOKEN))
], PipelineOrchestratorService);

// ../../packages/data-acquisition/src/adapters/alko.adapter.ts
init_modules_watch_stub();
var SUPPORTED_CURRENCY2 = "EUR";
function readNonEmptyString2(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
__name(readNonEmptyString2, "readNonEmptyString");
function readPositiveNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}
__name(readPositiveNumber, "readPositiveNumber");
function readAbv(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}
__name(readAbv, "readAbv");
function parseAlkoAssortment(payload) {
  const records = [];
  const errors = [];
  if (typeof payload !== "object" || payload === null) {
    return { records, errors: ["Alko payload is not a JSON object"] };
  }
  const assortment = payload;
  const source = readNonEmptyString2(assortment.source);
  if (source === null || source.toLowerCase() !== "alko") {
    errors.push(`Unexpected payload source "${String(assortment.source)}" \u2014 expected "alko"`);
    return { records, errors };
  }
  const currency = readNonEmptyString2(assortment.currency);
  if (currency === null || currency.toUpperCase() !== SUPPORTED_CURRENCY2) {
    errors.push(
      `Alko price list currency "${String(assortment.currency)}" is not ${SUPPORTED_CURRENCY2}; non-EUR merchant feeds require FX conversion at ingestion (task 1.4) and are rejected here`
    );
    return { records, errors };
  }
  if (!Array.isArray(assortment.products)) {
    errors.push("Alko payload has no products array");
    return { records, errors };
  }
  const rows = assortment.products;
  rows.forEach((row) => {
    const label = `product ${String(row.productId ?? "(unknown)")}`;
    const mapping = mapSourceCategory(readNonEmptyString2(row.productGroup) ?? "");
    if (mapping === null) {
      errors.push(
        `Failed to map ${label}: Finnish category "${String(row.productGroup)}" has no canonical mapping \u2014 flagged for the correction queue`
      );
      return;
    }
    const price = readPositiveNumber(row.price);
    if (price === null) {
      errors.push(`Failed to map ${label}: missing or invalid price "${String(row.price)}"`);
      return;
    }
    const alcoholPercentage = readAbv(row.alcoholPercentage);
    const volumeMl = readPositiveNumber(row.volumeMl);
    records.push({
      productId: readNonEmptyString2(row.productId) ?? "",
      productName: readNonEmptyString2(row.name) ?? "",
      manufacturer: readNonEmptyString2(row.manufacturer) ?? readNonEmptyString2(row.name) ?? "",
      brand: readNonEmptyString2(row.name) ?? "",
      category: mapping.taxCategory,
      alcoholByVolume: alcoholPercentage !== null ? alcoholPercentage / 100 : null,
      volumeMl: volumeMl ?? 0,
      containerType: readNonEmptyString2(row.packagingType) ?? "unknown",
      regulatoryClassification: mapping.taxCategory,
      depositSystem: true,
      // Finnish pantti applies to Alko containers
      ean: readNonEmptyString2(row.ean),
      // EUR-native: canonical and original amounts are the same cents;
      // no fxDatasetVersion — absence marks the no-conversion path.
      priceCents: Math.round(price * 100),
      currency: "EUR",
      originalPriceCents: Math.round(price * 100),
      originalCurrency: SUPPORTED_CURRENCY2,
      availability: "in_stock",
      sourceUrl: null
    });
  });
  return { records, errors };
}
__name(parseAlkoAssortment, "parseAlkoAssortment");
var AlkoFeedAdapter = class {
  static {
    __name(this, "AlkoFeedAdapter");
  }
  merchantId = "alko";
  /**
   * Fetch the latest assortment from the configured Alko feed URL and
   * map it to canonical records. Errors are collected per-item (and
   * per-payload for structural failures); never thrown for recoverable
   * failures.
   */
  async fetch(config) {
    try {
      const response = await fetch(config.feedUrl);
      if (!response.ok) {
        return {
          records: [],
          errors: [
            `Alko API returned HTTP ${response.status}: ${response.statusText}`
          ]
        };
      }
      return parseAlkoAssortment(await response.json());
    } catch (err) {
      return {
        records: [],
        errors: [
          `Alko fetch failed: ${err instanceof Error ? err.message : "Unknown error"}`
        ]
      };
    }
  }
};

// ../../packages/data-acquisition/src/adapters/systembolaget.adapter.ts
init_modules_watch_stub();
var SOURCE_CURRENCY = "SEK";
var SystembolagetFeedAdapter = class {
  constructor(fx) {
    this.fx = fx;
  }
  fx;
  merchantId = "systembolaget";
  /**
   * Fetch the latest assortment from Systembolaget's JSON API.
   *
   * Errors are collected per-item and returned alongside successfully mapped
   * records.  Network-level failures are reported as a single error entry.
   */
  async fetch(config) {
    const errors = [];
    const records = [];
    try {
      const response = await fetch(config.feedUrl);
      if (!response.ok) {
        errors.push(
          `Systembolaget API returned HTTP ${response.status}: ${response.statusText}`
        );
        return { records, errors };
      }
      const body = await response.json();
      const products = Array.isArray(body) ? body : body?.products;
      if (!Array.isArray(products)) {
        errors.push(
          "Systembolaget API returned unexpected JSON structure \u2014 expected an array or { products: [...] }"
        );
        return { records, errors };
      }
      const observedAt = /* @__PURE__ */ new Date();
      const rate = await this.resolveSekEurRate(observedAt, errors);
      for (const item of products) {
        try {
          records.push(this.mapToRecord(item, rate, observedAt));
        } catch (mapErr) {
          errors.push(
            `Failed to map product ${item.productId ?? "(unknown)"}: ${mapErr instanceof Error ? mapErr.message : "Unknown error"}`
          );
        }
      }
    } catch (err) {
      errors.push(
        `Systembolaget fetch failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
    return { records, errors };
  }
  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------
  /** Resolve the SEK→EUR rate effective on the observation date (or null). */
  async resolveSekEurRate(observedAt, errors) {
    if (this.fx === void 0) {
      errors.push(
        "No FX rate dataset service available \u2014 SEK offers cannot be converted"
      );
      return null;
    }
    try {
      return await this.fx.resolveRate(SOURCE_CURRENCY, "EUR", observedAt);
    } catch (err) {
      errors.push(
        `FX rate resolution failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      return null;
    }
  }
  /**
   * Map a single Systembolaget product to the canonical {@link RawFeedRecord}.
   *
   * @throws when the source category has no canonical mapping or the
   * SEK price has no effective conversion — the per-item catch upstream
   * reports it for the correction queue / rejection record.
   */
  mapToRecord(item, rate, observedAt) {
    const mapping = mapSourceCategory(item.category ?? "");
    if (mapping === null) {
      throw new Error(
        `Swedish category "${item.category}" has no canonical mapping \u2014 flagged for the correction queue`
      );
    }
    const originalPriceCents = item.price != null ? Math.round(item.price * 100) : 0;
    if (item.price != null && rate === null) {
      throw new Error(
        `SEK price ${item.price} has no effective ${SOURCE_CURRENCY}/EUR rate on ${observedAt.toISOString().slice(0, 10)} \u2014 offer rejected (unconvertible currency, design D2)`
      );
    }
    return {
      productId: item.productId,
      productName: item.productNameBold,
      manufacturer: item.productNameThin ?? item.productNameBold,
      brand: item.productNameBold,
      category: mapping.taxCategory,
      // API returns percentage (e.g. 5.2) — convert to decimal fraction
      alcoholByVolume: item.alcoholPercentage != null ? item.alcoholPercentage / 100 : null,
      volumeMl: item.bottleVolume ?? 0,
      containerType: item.apk ?? item.bottleText ?? "unknown",
      regulatoryClassification: mapping.taxCategory,
      depositSystem: false,
      ean: null,
      // Systembolaget JSON API does not expose EAN
      priceCents: item.price != null ? Math.round(item.price * rate.rate * 100) : 0,
      currency: "EUR",
      originalPriceCents,
      originalCurrency: SOURCE_CURRENCY,
      ...item.price != null ? { fxDatasetVersion: rate.dataset.versionLabel } : {},
      availability: "in_stock",
      sourceUrl: null
    };
  }
};
__name(SystembolagetFeedAdapter, "SystembolagetFeedAdapter");
SystembolagetFeedAdapter = __decorateClass([
  Injectable(),
  __decorateParam(0, Optional())
], SystembolagetFeedAdapter);

// ../../packages/data-acquisition/src/interfaces/merchant-config.interface.ts
init_modules_watch_stub();
var FEED_FORMATS = /* @__PURE__ */ new Set(["json", "xml", "csv"]);
function merchantConfigFromRegistry(record) {
  const feedFormat = record.feedFormat.trim().toLowerCase();
  if (!FEED_FORMATS.has(feedFormat)) {
    return {
      error: `Merchant "${record.merchantId}" has unsupported feed format "${record.feedFormat}" in the registry \u2014 expected json, xml, or csv`
    };
  }
  return {
    config: {
      merchantId: record.merchantId,
      name: record.name,
      country: record.country,
      feedUrl: record.feedUrl,
      feedFormat,
      pollingIntervalMs: record.pollingIntervalMs
    }
  };
}
__name(merchantConfigFromRegistry, "merchantConfigFromRegistry");

// ../../packages/application-api/src/ops/governance/in-memory-source-governance.repository.ts
init_modules_watch_stub();
var STATUS_PRIORITY = ["GRANTED", "PENDING", "EXPIRED", "REVOKED"];
var InMemorySourceGovernanceRepository = class {
  nextId = 1;
  records = /* @__PURE__ */ new Map();
  /** @inheritdoc */
  async create(input) {
    const now = /* @__PURE__ */ new Date();
    const record = {
      id: this.nextId++,
      merchantId: input.merchantId,
      acquisitionMethod: input.acquisitionMethod,
      permissionStatus: input.permissionStatus,
      sourceUrl: input.sourceUrl,
      statusReason: input.statusReason ?? null,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.id, record);
    return { ...record };
  }
  /** @inheritdoc */
  async updateStatus(id, status, reason) {
    const existing = this.records.get(id);
    if (existing === void 0) return null;
    const updated = {
      ...existing,
      permissionStatus: status,
      statusReason: reason ?? existing.statusReason,
      lastVerifiedAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    this.records.set(id, updated);
    return { ...updated };
  }
  /** @inheritdoc */
  async revokeAllByMerchantId(merchantId, reason) {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.merchantId !== merchantId) continue;
      if (record.permissionStatus === "REVOKED") continue;
      this.records.set(id, {
        ...record,
        permissionStatus: "REVOKED",
        statusReason: reason,
        lastVerifiedAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      });
      count++;
    }
    return count;
  }
  /** @inheritdoc */
  async findByMerchantId(merchantId) {
    const results = [...this.records.values()].filter((record) => record.merchantId === merchantId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.map((record) => ({ ...record }));
  }
  /** @inheritdoc */
  async findById(id) {
    const record = this.records.get(id);
    return record === void 0 ? null : { ...record };
  }
  /** @inheritdoc */
  async checkPermission(merchantId) {
    const sources = await this.findByMerchantId(merchantId);
    const permissionStatus = STATUS_PRIORITY.find(
      (status) => sources.some((source) => source.permissionStatus === status)
    ) ?? "PENDING";
    return {
      merchantId,
      permissionStatus,
      sources,
      hasWarnings: sources.some(
        (source) => source.permissionStatus === "EXPIRED" || source.permissionStatus === "REVOKED"
      )
    };
  }
};
__name(InMemorySourceGovernanceRepository, "InMemorySourceGovernanceRepository");
InMemorySourceGovernanceRepository = __decorateClass([
  Injectable()
], InMemorySourceGovernanceRepository);

// ../../packages/data-platform/src/repositories/d1/price-observation.repository.ts
init_modules_watch_stub();
var defaultIdCounter = 0;
function defaultObservationId() {
  const id = Date.now() * 4096 + defaultIdCounter % 4096;
  defaultIdCounter += 1;
  return id;
}
__name(defaultObservationId, "defaultObservationId");
function toObservationLogRecord(observation, id) {
  return {
    id,
    product_id: observation.productId,
    merchant: observation.merchant,
    retail_offer_id: observation.retailOfferId,
    observed_at: observation.observedAt.toISOString(),
    foreign_retail_price_cents: observation.foreignRetailPriceCents,
    transport_cost_cents: observation.transportCostCents,
    transport_offer_id: observation.transportOfferId,
    excise_rule_version_id: observation.exciseRuleVersion?.ruleId ?? null,
    container_duty_rule_version_id: observation.containerDutyRuleVersion?.ruleId ?? null,
    landed_cost_cents: observation.landedCostCents,
    input_reliability: observation.inputReliability,
    confidence: observation.confidence
  };
}
__name(toObservationLogRecord, "toObservationLogRecord");
var R2PriceObservationPort = class {
  constructor(store, nextId = defaultObservationId) {
    this.store = store;
    this.nextId = nextId;
  }
  store;
  nextId;
  /**
   * Append one observation: assign the id, serialize to the R2 layout,
   * and delegate the append to the date-partitioned object of the
   * observation's UTC day. Returns the assigned row id.
   */
  async append(observation) {
    const id = this.nextId();
    const record = toObservationLogRecord(observation, id);
    await this.store.appendLine(
      observationObjectKey(observation.observedAt),
      serializeObservationLine(record)
    );
    return { id };
  }
};
__name(R2PriceObservationPort, "R2PriceObservationPort");
R2PriceObservationPort = __decorateClass([
  Injectable()
], R2PriceObservationPort);

// src/adapters/d1-upsert.repository.ts
init_modules_watch_stub();
function toReal(value) {
  if (value === null || value === void 0 || value === "") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
__name(toReal, "toReal");
function toRealRequired(value) {
  return toReal(value) ?? 0;
}
__name(toRealRequired, "toRealRequired");
function toInt(value) {
  return value === null || value === void 0 ? null : value ? 1 : 0;
}
__name(toInt, "toInt");
var FIND_BY_EAN_SQL = `SELECT id FROM product_master WHERE ean = ? LIMIT 1`;
var UPDATE_BY_EAN_SQL2 = `
  UPDATE product_master SET
    name = ?, manufacturer = ?, brand = ?, category = ?, alcohol_by_volume = ?,
    unit_volume = ?, container_type = ?, regulatory_classification = ?,
    deposit_system_status = ?, updated_at = ?
  WHERE id = ?`;
var FIND_BY_COMPOUND_SQL = `
  SELECT id FROM product_master
   WHERE name = ? AND brand = ? AND container_type = ? AND unit_volume = ?
   LIMIT 1`;
var UPDATE_COMPOUND_SQL = `
  UPDATE product_master
     SET updated_at = ?, ean = COALESCE(?, ean)
   WHERE id = ?`;
var INSERT_PRODUCT_SQL = `
  INSERT INTO product_master (
    name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;
var LATEST_OFFER_PRICE_SQL = `
  SELECT price_cents FROM retail_offers
   WHERE merchant = ? AND product_id = ?
   ORDER BY observed_at DESC, id DESC
   LIMIT 1`;
var INSERT_OFFER_SQL = `
  INSERT INTO retail_offers (
    merchant, country, product_id, price_cents, currency,
    original_price_cents, original_currency, fx_dataset_version,
    availability, source_url, observed_at, reliability_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;
var D1UpsertRepository = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  static {
    __name(this, "D1UpsertRepository");
  }
  /** @inheritdoc */
  async upsertProduct(input) {
    const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const alcoholByVolume = toReal(input.alcoholByVolume);
    const unitVolume = toRealRequired(input.unitVolume);
    const depositSystemStatus = toInt(input.depositSystemStatus);
    if (input.ean) {
      const byEan = await this.d1.prepare(FIND_BY_EAN_SQL).bind(input.ean).first();
      if (byEan !== null) {
        await this.d1.prepare(UPDATE_BY_EAN_SQL2).bind(
          input.name,
          input.manufacturer,
          input.brand,
          input.category,
          alcoholByVolume,
          unitVolume,
          input.containerType,
          input.regulatoryClassification,
          depositSystemStatus,
          updatedAt,
          byEan.id
        ).run();
        return { productId: byEan.id, created: false };
      }
    }
    const byCompound = await this.d1.prepare(FIND_BY_COMPOUND_SQL).bind(input.name, input.brand, input.containerType, unitVolume).first();
    if (byCompound !== null) {
      await this.d1.prepare(UPDATE_COMPOUND_SQL).bind(updatedAt, input.ean ?? null, byCompound.id).run();
      return { productId: byCompound.id, created: false };
    }
    const row = await this.d1.prepare(INSERT_PRODUCT_SQL).bind(
      input.name,
      input.manufacturer,
      input.brand,
      input.category,
      alcoholByVolume,
      unitVolume,
      input.containerType,
      input.regulatoryClassification,
      depositSystemStatus,
      input.ean ?? null
    ).first();
    if (row === null) {
      throw new Error("product_master INSERT .. RETURNING returned no row");
    }
    return { productId: row.id, created: true };
  }
  /** @inheritdoc */
  async upsertOffer(input) {
    const previous = await this.d1.prepare(LATEST_OFFER_PRICE_SQL).bind(input.merchant, input.productId).first();
    const changed = previous === null || previous.price_cents !== input.priceCents;
    const row = await this.d1.prepare(INSERT_OFFER_SQL).bind(
      input.merchant,
      input.country,
      input.productId,
      input.priceCents,
      input.currency,
      input.originalPriceCents ?? null,
      input.originalCurrency ?? null,
      input.fxDatasetVersion ?? null,
      input.availability,
      input.sourceUrl ?? null,
      input.observedAt.toISOString(),
      input.reliabilityStatus
    ).first();
    if (row === null) {
      throw new Error("retail_offers INSERT .. RETURNING returned no row");
    }
    return { offerId: row.id, changed };
  }
};

// src/adapters/offer-change-recorder-hook.ts
init_modules_watch_stub();
function toReliabilityStatus2(value) {
  return value === "VERIFIED" || value === "STALE" || value === "UNAVAILABLE" ? value : "ESTIMATED";
}
__name(toReliabilityStatus2, "toReliabilityStatus");
var OfferChangeRecorderHook = class {
  constructor(recorder) {
    this.recorder = recorder;
  }
  recorder;
  static {
    __name(this, "OfferChangeRecorderHook");
  }
  /**
   * Map the changed-offer event to the recorder's input shape (the
   * calculator's retail-offer read model) and append one observation.
   */
  async onOfferChanged(event) {
    await this.recorder.record({
      productId: event.productId,
      offer: {
        id: event.offerId,
        priceCents: event.priceCents,
        merchant: event.merchant,
        country: event.country,
        reliabilityStatus: toReliabilityStatus2(event.reliabilityStatus)
      },
      observedAt: event.observedAt
    });
  }
};

// src/queues/pipeline.ts
function composeMerchantRegistry(env) {
  return new D1MerchantRegistryRepository(env.DB);
}
__name(composeMerchantRegistry, "composeMerchantRegistry");
function composeGovernanceService(repository = new InMemorySourceGovernanceRepository()) {
  return new SourceGovernanceService(repository);
}
__name(composeGovernanceService, "composeGovernanceService");
function composeFxRateDatasetService(env) {
  return new FxRateDatasetService(
    new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB))
  );
}
__name(composeFxRateDatasetService, "composeFxRateDatasetService");

// src/cron/transport-rate-refresh.ts
var TRANSPORT_REFRESH_CRON = "0 */6 * * *";
var NEWEST_OFFER_AGE_METRIC = "rajahinta_transport_newest_offer_age_seconds";
var ALL_CARRIERS2 = "*";
function composeCarrierRateSources() {
  const posti = new PostiCarrierRateSource();
  const map = /* @__PURE__ */ new Map();
  map.set(posti.carrierId, posti);
  return map;
}
__name(composeCarrierRateSources, "composeCarrierRateSources");
async function handleTransportRateRefresh(env, log, deps = {}) {
  const refresh = deps.refresh ?? ((carrierId) => {
    const adapter = new PipelineTransportRateAdapter(
      composeGovernanceService(),
      composeCarrierRateSources(),
      new D1TransportOfferWritePort(env.DB)
    );
    return adapter.refreshCarrierRates(carrierId);
  });
  log.info({ message: "Running 6-hourly transport-rate refresh" });
  const result = await refresh(ALL_CARRIERS2);
  log.info({
    message: `Refreshed ${result.ratesUpdated} transport rates for all carriers`,
    ratesUpdated: result.ratesUpdated
  });
  assessFreshness(log, result.newestOfferObservedAt);
  return result;
}
__name(handleTransportRateRefresh, "handleTransportRateRefresh");
function assessFreshness(log, newestOfferObservedAt) {
  if (newestOfferObservedAt === null) {
    log.error({
      message: `${NEWEST_OFFER_AGE_METRIC}=+Inf TRANSPORT_FRESHNESS_ALERT: no transport offers exist \u2014 newest offer age exceeds the 7-day threshold by definition`
    });
    return;
  }
  const ageMs = Date.now() - newestOfferObservedAt.getTime();
  const ageSeconds = Math.max(0, Math.floor(ageMs / 1e3));
  const thresholdMs = DEFAULT_STALENESS_THRESHOLDS.transport.milliseconds;
  if (ageMs > thresholdMs) {
    const ageDays = (ageSeconds / 86400).toFixed(1);
    log.error({
      message: `${NEWEST_OFFER_AGE_METRIC}=${ageSeconds} TRANSPORT_FRESHNESS_ALERT: newest transport offer is ${ageDays} days old (observed ` + newestOfferObservedAt.toISOString() + ") \u2014 exceeds the 7-day threshold; transport costs on all calculations degrade to ESTIMATED/UNAVAILABLE"
    });
  }
}
__name(assessFreshness, "assessFreshness");

// src/cron/tax-dataset-review.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/adapters/rate-snapshot.r2.ts
init_modules_watch_stub();
var DEFAULT_RATE_SNAPSHOT_OBJECT_KEY = "config/rate-snapshot.json";
async function sha256Hex3(content) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex3, "sha256Hex");
var R2RateSnapshotSource = class {
  constructor(bucket, objectKey, repository, options = {}) {
    this.bucket = bucket;
    this.objectKey = objectKey;
    this.repository = repository;
    this.logger = options.logger ?? console;
  }
  bucket;
  objectKey;
  repository;
  static {
    __name(this, "R2RateSnapshotSource");
  }
  logger;
  async checkForChanges() {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    let content;
    try {
      const object = await this.bucket.get(this.objectKey);
      if (object === null) {
        this.logger.warn?.({
          message: `Rate snapshot object "${this.objectKey}" not found in the bucket \u2014 degrading to no-change (fail-safe)`
        });
        return { checkedAt, newRatesDetected: false };
      }
      content = await object.text();
    } catch (err) {
      this.logger.error?.({
        message: "Failed to read rate snapshot from R2 \u2014 degrading to no-change: " + (err instanceof Error ? err.message : String(err))
      });
      return { checkedAt, newRatesDetected: false };
    }
    const hash = await sha256Hex3(content);
    let lastEntry;
    try {
      lastEntry = await this.getLatestEntry();
    } catch (err) {
      this.logger.error?.({
        message: "Failed to look up the last rate-review entry \u2014 degrading to no-change: " + (err instanceof Error ? err.message : String(err))
      });
      return { checkedAt, newRatesDetected: false };
    }
    const lastHash = lastEntry?.contentHash;
    if (lastHash === hash) {
      this.logger.info?.({
        message: "Snapshot content unchanged \u2014 no new rates detected"
      });
      return { checkedAt, newRatesDetected: false };
    }
    this.logger.warn?.({
      message: "Snapshot content changed \u2014 new rates detected"
    });
    return {
      checkedAt,
      newRatesDetected: true,
      reviewId: crypto.randomUUID(),
      detectedVersions: [`snapshot-hash:${hash.slice(0, 12)}`]
    };
  }
  /**
   * Most recent review entry, preferring pending over resolved. Entries
   * are ordered newest-first by the repository implementation (same
   * precedence as ConfigBackedRateChangeSource).
   */
  async getLatestEntry() {
    const pending = await this.repository.findByStatus("pending");
    if (pending.length > 0) return pending[0];
    const resolved = await this.repository.findByStatus("resolved");
    return resolved.length > 0 ? resolved[0] : null;
  }
};

// ../../packages/data-acquisition/src/adapters/rate-review-repository.adapter.ts
init_modules_watch_stub();
var InMemoryRateReviewRepository = class {
  entries = /* @__PURE__ */ new Map();
  async create(entry) {
    if (this.entries.has(entry.id)) {
      throw new Error(
        `Rate-review entry with id "${entry.id}" already exists`
      );
    }
    this.entries.set(entry.id, { ...entry });
  }
  async findById(id) {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : null;
  }
  async findByStatus(status) {
    const results = [];
    for (const entry of this.entries.values()) {
      if (entry.status === status) {
        results.push({ ...entry });
      }
    }
    results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return results;
  }
  async updateStatus(id, status, resolution, resolvedAt, reviewerNotes) {
    const existing = this.entries.get(id);
    if (!existing) {
      throw new Error(
        `Cannot update status: no rate-review entry with id "${id}"`
      );
    }
    this.entries.set(id, {
      ...existing,
      status,
      ...resolution !== void 0 ? { resolution } : {},
      ...resolvedAt !== void 0 ? { resolvedAt } : {},
      ...reviewerNotes !== void 0 ? { reviewerNotes } : {}
    });
  }
};
__name(InMemoryRateReviewRepository, "InMemoryRateReviewRepository");
InMemoryRateReviewRepository = __decorateClass([
  Injectable()
], InMemoryRateReviewRepository);

// src/cron/tax-dataset-review.ts
var TAX_REVIEW_CRON = "0 2 * * *";
var DisabledRateChangeSource = class {
  static {
    __name(this, "DisabledRateChangeSource");
  }
  async checkForChanges() {
    return { checkedAt: (/* @__PURE__ */ new Date()).toISOString(), newRatesDetected: false };
  }
};
function composeRateChangeSource(env, log) {
  const bucket = env.RATE_SNAPSHOTS;
  if (!bucket) {
    return new DisabledRateChangeSource();
  }
  const objectKey = env.RATE_SNAPSHOT_OBJECT_KEY?.trim() || DEFAULT_RATE_SNAPSHOT_OBJECT_KEY;
  return new R2RateSnapshotSource(bucket, objectKey, new InMemoryRateReviewRepository(), {
    logger: log
  });
}
__name(composeRateChangeSource, "composeRateChangeSource");
function toTaxReviewCheckResult(result) {
  if (result.newRatesDetected) {
    return {
      datasetsFound: 1,
      requiresConfirmation: true,
      detectedVersions: result.detectedVersions
    };
  }
  return { datasetsFound: 0, requiresConfirmation: false };
}
__name(toTaxReviewCheckResult, "toTaxReviewCheckResult");
async function handleTaxDatasetReview(env, log, deps = {}) {
  log.info({ message: "Checking for newly published official tax rates" });
  const source = deps.rateChangeSource ?? composeRateChangeSource(env, log);
  const result = toTaxReviewCheckResult(await source.checkForChanges());
  log.info({
    message: `Found ${result.datasetsFound} new dataset(s), requires confirmation: ${result.requiresConfirmation}`,
    datasetsFound: result.datasetsFound
  });
  if (result.requiresConfirmation) {
    log.warn({
      message: "New tax datasets found requiring manual confirmation \u2014 no rates auto-published"
    });
    const versions = result.detectedVersions;
    if (versions !== void 0 && versions.length > 0) {
      log.info({
        message: `Invalidating idempotency cache for versions: ${versions.join(", ")}`
      });
      const invalidate = deps.invalidateVersions ?? ((versions2) => idempotencyInvalidateVersions(env, versions2));
      await invalidate([...versions]);
    }
  }
  return result;
}
__name(handleTaxDatasetReview, "handleTaxDatasetReview");

// src/cron/fx-dataset-review.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/adapters/ecb-rate.source.ts
init_modules_watch_stub();

// ../../packages/data-acquisition/src/interfaces/fx-rate-source.port.ts
init_modules_watch_stub();
var FX_RATE_SOURCE_PORT = "FX_RATE_SOURCE_PORT";
var FX_RATE_SOURCE_URL_DEFAULT = "https://api.frankfurter.dev/v1/latest";

// ../../packages/data-acquisition/src/adapters/ecb-rate.source.ts
function readNonEmptyString3(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
__name(readNonEmptyString3, "readNonEmptyString");
var EXPECTED_BASE = "EUR";
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var ISO_4217 = /^[A-Z]{3}$/;
function parseEcbReferenceRates(payload) {
  const errors = [];
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { snapshot: null, errors: ["ECB payload is not a JSON object"] };
  }
  const body = payload;
  const base = readNonEmptyString3(body.base);
  if (base === null || base.toUpperCase() !== EXPECTED_BASE) {
    errors.push(
      `ECB payload base "${String(body.base)}" is not ${EXPECTED_BASE}; ECB reference rates are EUR-base and any other base needs a different dataset contract`
    );
    return { snapshot: null, errors };
  }
  const referenceDate = readNonEmptyString3(body.date);
  if (referenceDate === null || !ISO_DATE.test(referenceDate)) {
    errors.push(
      `ECB payload lacks a valid reference date \u2014 got "${String(body.date)}" (expected YYYY-MM-DD)`
    );
    return { snapshot: null, errors };
  }
  if (typeof body.rates !== "object" || body.rates === null || Array.isArray(body.rates)) {
    errors.push("ECB payload has no rates object");
    return { snapshot: null, errors };
  }
  const rates = [];
  for (const [rawCode, rawRate] of Object.entries(body.rates)) {
    const code = rawCode.trim().toUpperCase();
    if (!ISO_4217.test(code)) {
      errors.push(`ECB rates entry "${rawCode}" is not an ISO-4217 alpha-3 code \u2014 skipped`);
      continue;
    }
    if (code === EXPECTED_BASE) {
      errors.push("ECB rates contains a EUR/EUR self-pair \u2014 skipped");
      continue;
    }
    if (typeof rawRate !== "number" || !Number.isFinite(rawRate) || rawRate <= 0) {
      errors.push(`ECB rate for ${code} is not a positive number \u2014 skipped`);
      continue;
    }
    rates.push({ baseCurrency: EXPECTED_BASE, quoteCurrency: code, rate: rawRate });
  }
  if (rates.length === 0) {
    errors.push("ECB payload carried no valid rate entries");
    return { snapshot: null, errors };
  }
  return {
    snapshot: {
      sourceId: "ecb",
      sourceName: "ecb-reference-rates",
      sourceUrl: null,
      referenceDate,
      rates
    },
    errors
  };
}
__name(parseEcbReferenceRates, "parseEcbReferenceRates");
var jsonFetcher2 = /* @__PURE__ */ __name(async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}, "jsonFetcher");
var EcbReferenceRateSource = class {
  constructor(fetcher = jsonFetcher2, feedUrl = FX_RATE_SOURCE_URL_DEFAULT) {
    this.fetcher = fetcher;
    this.feedUrl = feedUrl;
  }
  fetcher;
  feedUrl;
  sourceId = "ecb";
  async fetchLatestRates() {
    try {
      const payload = await this.fetcher(this.feedUrl);
      return parseEcbReferenceRates(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { snapshot: null, errors: [`ECB fetch failed: ${message}`] };
    }
  }
};
__name(EcbReferenceRateSource, "EcbReferenceRateSource");
EcbReferenceRateSource = __decorateClass([
  Injectable(),
  __decorateParam(0, Optional()),
  __decorateParam(1, Optional())
], EcbReferenceRateSource);

// ../../packages/data-acquisition/src/services/fx-dataset-review.service.ts
init_modules_watch_stub();
var FxDatasetReviewService = class {
  constructor(rateSource, fxDatasets) {
    this.rateSource = rateSource;
    this.fxDatasets = fxDatasets;
  }
  rateSource;
  fxDatasets;
  logger = new Logger(FxDatasetReviewService.name);
  /**
   * Check the configured source for newly available reference rates.
   *
   * A new reference date becomes a PENDING_CONFIRMATION dataset — the
   * confirmation task surfaced to the operator via the pending-dataset
   * review queue (FxRateDatasetService.listPendingDatasets). An
   * already-known reference date is a no-op. Never publishes.
   */
  async checkForNewRates() {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    const { snapshot, errors } = await this.rateSource.fetchLatestRates();
    if (snapshot === null) {
      if (errors.length > 0) {
        this.logger.warn(
          `FX rate source reported ${errors.length} error(s): ${errors.join("; ")}`
        );
      }
      return {
        checkedAt,
        datasetsFound: 0,
        requiresConfirmation: false,
        detectedVersions: [],
        errors
      };
    }
    const versionLabel = this.versionLabelFor(snapshot);
    const existing = await this.fxDatasets.getDatasetByVersion(versionLabel);
    if (existing !== null) {
      return {
        checkedAt,
        datasetsFound: 0,
        requiresConfirmation: existing.status === "PENDING_CONFIRMATION",
        detectedVersions: [versionLabel],
        errors
      };
    }
    try {
      const dataset = await this.fxDatasets.createPendingDataset({
        versionLabel,
        sourceName: snapshot.sourceName,
        sourceUrl: snapshot.sourceUrl ?? void 0,
        referenceDate: snapshot.referenceDate,
        // The ECB reference rate for a date is effective from that
        // date, open-ended until a confirmed successor takes over
        // (most-recent effectiveFrom wins during any overlap).
        effectiveFrom: /* @__PURE__ */ new Date(`${snapshot.referenceDate}T00:00:00.000Z`),
        effectiveTo: null,
        rates: snapshot.rates
      });
      this.logger.warn(
        `FX dataset ${versionLabel} created in PENDING_CONFIRMATION \u2014 manual operator confirmation required before it becomes effective`
      );
      return {
        checkedAt,
        datasetsFound: 1,
        requiresConfirmation: true,
        detectedVersions: [dataset.versionLabel],
        errors
      };
    } catch (err) {
      if (isFxDatasetVersionConflict(err)) {
        this.logger.log(
          `FX dataset ${versionLabel} already created by a concurrent check \u2014 nothing to do`
        );
        return {
          checkedAt,
          datasetsFound: 0,
          requiresConfirmation: true,
          detectedVersions: [versionLabel],
          errors
        };
      }
      throw err;
    }
  }
  /** Deterministic dataset identity for a snapshot — drives idempotency. */
  versionLabelFor(snapshot) {
    return `${snapshot.sourceId}-${snapshot.referenceDate}`;
  }
};
__name(FxDatasetReviewService, "FxDatasetReviewService");
FxDatasetReviewService = __decorateClass([
  Injectable(),
  __decorateParam(0, Inject(FX_RATE_SOURCE_PORT))
], FxDatasetReviewService);
function isFxDatasetVersionConflict(err) {
  return err instanceof Error && err.name === "FxDatasetVersionConflictError";
}
__name(isFxDatasetVersionConflict, "isFxDatasetVersionConflict");

// src/cron/fx-dataset-review.ts
var FX_REVIEW_CRON = "0 3 * * *";
async function handleFxDatasetReview(env, log, deps = {}) {
  log.info({
    message: "Checking the FX rate source for newly available reference rates"
  });
  const rateSource = deps.rateSource ?? new EcbReferenceRateSource(
    void 0,
    env.FX_RATE_SOURCE_URL ?? FX_RATE_SOURCE_URL_DEFAULT
  );
  const fxReview = new FxDatasetReviewService(
    rateSource,
    composeFxRateDatasetService(env)
  );
  const result = await fxReview.checkForNewRates();
  if (result.errors.length > 0) {
    log.warn({
      message: `FX rate check reported ${result.errors.length} source error(s): ${result.errors.join("; ")}`
    });
  }
  if (result.requiresConfirmation) {
    log.warn({
      message: `FX dataset ${result.detectedVersions.join(", ")} awaiting manual confirmation \u2014 no rates auto-published`
    });
  } else {
    log.info({
      message: `No new FX datasets (${result.datasetsFound} created this check)`
    });
  }
  return result;
}
__name(handleFxDatasetReview, "handleFxDatasetReview");

// src/cron/time-series-aggregation.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/d1/summary-aggregation.ts
init_modules_watch_stub();
var BUCKET_WINDOW_MS = {
  daily: 864e5,
  weekly: 7 * 864e5
};
function startOfUtcDay(instant) {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())
  );
}
__name(startOfUtcDay, "startOfUtcDay");
function startOfIsoWeek(instant) {
  const day = startOfUtcDay(instant);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * 864e5);
}
__name(startOfIsoWeek, "startOfIsoWeek");
function bucketAnchor(granularity, instant) {
  return granularity === "daily" ? startOfUtcDay(instant) : startOfIsoWeek(instant);
}
__name(bucketAnchor, "bucketAnchor");
function averageCentsHalfUp(sumCents, count) {
  return Math.floor((2 * sumCents + count) / (2 * count));
}
__name(averageCentsHalfUp, "averageCentsHalfUp");
function strictestReliability(statuses) {
  let strictest = RELIABILITY_ORDER[0];
  for (const status of statuses) {
    if (RELIABILITY_ORDER.indexOf(status) > RELIABILITY_ORDER.indexOf(strictest)) {
      strictest = status;
    }
  }
  return strictest;
}
__name(strictestReliability, "strictestReliability");
function isReliabilityStatus2(value) {
  return typeof value === "string" && RELIABILITY_ORDER.includes(value);
}
__name(isReliabilityStatus2, "isReliabilityStatus");
function observationReliability(observation) {
  const snapshot = observation.input_reliability;
  const known = Object.values(snapshot ?? {}).filter(isReliabilityStatus2);
  return known.length > 0 ? strictestReliability(known) : "UNAVAILABLE";
}
__name(observationReliability, "observationReliability");
function buildBucketSummaries(granularity, periodStart, observations) {
  if (observations.length === 0) {
    return [];
  }
  const ordered = [...observations].sort((a, b) => {
    if (a.observed_at !== b.observed_at) {
      return a.observed_at < b.observed_at ? -1 : 1;
    }
    return a.id - b.id;
  });
  const byMerchant = /* @__PURE__ */ new Map();
  for (const observation of ordered) {
    const group = byMerchant.get(observation.merchant);
    if (group) {
      group.push(observation);
    } else {
      byMerchant.set(observation.merchant, [observation]);
    }
  }
  const periodStartDay = periodStart.toISOString().slice(0, 10);
  const productId = ordered[0].product_id;
  const summaries = [];
  const emit = /* @__PURE__ */ __name((merchant, rows) => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    let priceSum = 0;
    let landedSum = 0;
    let priceMin = first.foreign_retail_price_cents;
    let priceMax = first.foreign_retail_price_cents;
    let landedMin = first.landed_cost_cents;
    let landedMax = first.landed_cost_cents;
    for (const row of rows) {
      priceSum += row.foreign_retail_price_cents;
      landedSum += row.landed_cost_cents;
      priceMin = Math.min(priceMin, row.foreign_retail_price_cents);
      priceMax = Math.max(priceMax, row.foreign_retail_price_cents);
      landedMin = Math.min(landedMin, row.landed_cost_cents);
      landedMax = Math.max(landedMax, row.landed_cost_cents);
    }
    summaries.push({
      granularity,
      periodStart: periodStartDay,
      productId,
      merchant,
      priceOpenCents: first.foreign_retail_price_cents,
      priceCloseCents: last.foreign_retail_price_cents,
      priceMinCents: priceMin,
      priceMaxCents: priceMax,
      priceAvgCents: averageCentsHalfUp(priceSum, rows.length),
      landedCostOpenCents: first.landed_cost_cents,
      landedCostCloseCents: last.landed_cost_cents,
      landedCostMinCents: landedMin,
      landedCostMaxCents: landedMax,
      landedCostAvgCents: averageCentsHalfUp(landedSum, rows.length),
      observationCount: rows.length,
      strictestReliability: strictestReliability(
        rows.map(observationReliability)
      )
    });
  }, "emit");
  for (const [merchant, rows] of byMerchant) {
    emit(merchant, rows);
  }
  emit(null, ordered);
  return summaries;
}
__name(buildBucketSummaries, "buildBucketSummaries");

// ../../packages/data-platform/src/repositories/d1/aggregation-watermark.repository.ts
init_modules_watch_stub();
var FIND_SQL = `
  SELECT watermark FROM aggregation_watermarks WHERE job_name = ?`;
var UPSERT_SQL3 = `
  INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT (job_name) DO UPDATE SET
    watermark = excluded.watermark,
    updated_at = excluded.updated_at`;
var D1AggregationWatermarkRepository = class extends AggregationWatermarkRepository {
  constructor(d1) {
    super();
    this.d1 = d1;
  }
  d1;
  /**
   * Current watermark for a job, or null when the job has never completed
   * a scan (callers start from the epoch on first run).
   */
  async find(jobName) {
    const row = await this.d1.prepare(FIND_SQL).bind(jobName).first();
    return row ? new Date(row.watermark) : null;
  }
  /**
   * Persist the watermark for a job (insert or overwrite by job name —
   * the job_name UNIQUE constraint is a plain single-column key, so the
   * native ON CONFLICT upsert is sound here). Callers must only ever
   * advance the value — never regress it.
   */
  async save(jobName, watermark) {
    await this.d1.prepare(UPSERT_SQL3).bind(jobName, watermark.toISOString(), (/* @__PURE__ */ new Date()).toISOString()).run();
  }
};
__name(D1AggregationWatermarkRepository, "D1AggregationWatermarkRepository");
D1AggregationWatermarkRepository = __decorateClass([
  Injectable()
], D1AggregationWatermarkRepository);

// src/cron/time-series-aggregation.ts
var AGGREGATION_CRON = "*/30 * * * *";
var WATERMARK_KEY = "time-series-aggregation";
var GRANULARITIES = ["daily", "weekly"];
async function handleTimeSeriesAggregation(env, log, deps = {}) {
  const store = deps.store ?? observationLogStore(env);
  const summaries = deps.summaries ?? new D1PriceHistorySummaryRepository(env.DB);
  const watermarks = deps.watermarks ?? new D1AggregationWatermarkRepository(env.DB);
  const watermark = await watermarks.find(WATERMARK_KEY);
  const keys = await store.listKeys(OBSERVATION_LOG_PREFIX);
  const readFrom = watermark === null ? null : startOfIsoWeek(watermark);
  const scanKeys = observationKeysToScan(keys, readFrom);
  const allRecords = await readPartitions(store, scanKeys);
  const activeRecords = watermark === null ? allRecords : allRecords.filter(
    (record) => new Date(record.observed_at) >= watermark
  );
  if (activeRecords.length === 0) {
    log.info({
      message: "No observations in scan range \u2014 nothing to aggregate",
      watermark: watermark?.toISOString() ?? "none"
    });
    return { products: 0, bucketsWritten: 0, watermark: null };
  }
  log.info({
    message: `Scanning observations from ${minObservedAt(activeRecords)} (watermark: ${watermark?.toISOString() ?? "none"})`,
    partitions: scanKeys.length,
    observations: allRecords.length
  });
  const activeByProduct = groupByProduct(activeRecords);
  const allByProduct = groupByProduct(allRecords);
  let bucketsWritten = 0;
  for (const [, records] of activeByProduct) {
    const productId = records[0].product_id;
    bucketsWritten += await aggregateProduct(
      summaries,
      allByProduct.get(productId) ?? []
    );
  }
  const scannedHighWater = activeRecords.reduce(
    (max, record) => record.observed_at > max.observed_at ? record : max,
    activeRecords[0]
  );
  const nextInstant = new Date(scannedHighWater.observed_at);
  const next = watermark !== null && watermark > nextInstant ? watermark : nextInstant;
  if (watermark === null || next > watermark) {
    await watermarks.save(WATERMARK_KEY, next);
  }
  log.info({
    message: `Aggregated ${bucketsWritten} summary buckets across ${activeByProduct.size} products; watermark now ${next.toISOString()}`,
    bucketsWritten,
    products: activeByProduct.size
  });
  return {
    products: activeByProduct.size,
    bucketsWritten,
    watermark: next.toISOString()
  };
}
__name(handleTimeSeriesAggregation, "handleTimeSeriesAggregation");
async function readPartitions(store, scanKeys) {
  const records = [];
  for (const key of scanKeys) {
    const body = await store.readObject(key);
    if (body === null) continue;
    records.push(...parseObservationLog(body));
  }
  return records;
}
__name(readPartitions, "readPartitions");
function groupByProduct(records) {
  const byProduct = /* @__PURE__ */ new Map();
  for (const record of records) {
    const group = byProduct.get(record.product_id);
    if (group) {
      group.push(record);
    } else {
      byProduct.set(record.product_id, [record]);
    }
  }
  return byProduct;
}
__name(groupByProduct, "groupByProduct");
async function aggregateProduct(summaries, productRecords) {
  let written = 0;
  const sorted = [...productRecords].sort(
    (a, b) => a.observed_at !== b.observed_at ? a.observed_at < b.observed_at ? -1 : 1 : a.id - b.id
  );
  const firstObservedAt = new Date(sorted[0].observed_at);
  const lastObservedAt = new Date(sorted[sorted.length - 1].observed_at);
  for (const granularity of GRANULARITIES) {
    const windowMs = BUCKET_WINDOW_MS[granularity];
    for (let bucket = bucketAnchor(granularity, firstObservedAt); bucket <= lastObservedAt; bucket = new Date(bucket.getTime() + windowMs)) {
      const bucketEnd = new Date(bucket.getTime() + windowMs);
      const bucketObservations = sorted.filter((record) => {
        const instant = new Date(record.observed_at);
        return instant >= bucket && instant < bucketEnd;
      });
      if (bucketObservations.length === 0) {
        continue;
      }
      for (const summary of buildBucketSummaries(
        granularity,
        bucket,
        bucketObservations
      )) {
        await summaries.upsertBucket(summary);
        written++;
      }
    }
  }
  return written;
}
__name(aggregateProduct, "aggregateProduct");
function minObservedAt(records) {
  return records.reduce(
    (min, record) => record.observed_at < min ? record.observed_at : min,
    records[0].observed_at
  );
}
__name(minObservedAt, "minObservedAt");

// src/cron/retention-sweep.ts
init_modules_watch_stub();

// ../../packages/data-platform/src/repositories/d1/calculation-record-retention.ts
init_modules_watch_stub();
var RETENTION_DAYS_ENV = "CALCULATION_RECORD_RETENTION_DAYS";
var DEFAULT_RETENTION_DAYS = 30;
var AGE_CAP_DAYS_ENV = "CALCULATION_RECORD_AGE_CAP_DAYS";
var DEFAULT_AGE_CAP_DAYS = 180;
var DEFAULT_BATCH_SIZE = 500;
var MS_PER_DAY2 = 864e5;
var RETENTION_TABLES = [
  { table: "calculation_records", timeColumn: "calculated_at" },
  { table: "basket_calculation_records", timeColumn: "created_at" }
];
var D1CalculationRecordRetentionService = class {
  constructor(d1) {
    this.d1 = d1;
  }
  d1;
  /**
   * Run one retention sweep: prune anonymous rows past the configured
   * window, then age-cap every record past the configured cap — both as
   * bounded batch DELETEs.
   */
  async runRetention(overrides) {
    const now = overrides?.now ?? /* @__PURE__ */ new Date();
    const retentionDays = overrides?.retentionDays ?? this.configuredDays(RETENTION_DAYS_ENV, DEFAULT_RETENTION_DAYS);
    const ageCapDays = overrides?.ageCapDays ?? this.configuredDays(AGE_CAP_DAYS_ENV, DEFAULT_AGE_CAP_DAYS);
    const batchSize = overrides?.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(`batchSize must be a positive integer, got ${batchSize}`);
    }
    const anonymousCutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY2);
    const ageCapCutoff = new Date(now.getTime() - ageCapDays * MS_PER_DAY2);
    const prunedAnonymous = {};
    const ageCapped = {};
    for (const { table, timeColumn } of RETENTION_TABLES) {
      prunedAnonymous[table] = await this.deleteBatched(
        table,
        timeColumn,
        anonymousCutoff,
        batchSize,
        true
      );
      ageCapped[table] = await this.deleteBatched(
        table,
        timeColumn,
        ageCapCutoff,
        batchSize,
        false
      );
    }
    return { prunedAnonymous, ageCapped, anonymousCutoff, ageCapCutoff, batchSize };
  }
  /**
   * Bounded batch DELETE: repeatedly delete up to {@code batchSize} rows
   * matching the window predicate until a batch comes back short. The
   * age-cap pass is the strict superset of the anonymous predicate
   * (every anonymous row past the window is also past the cap), so the
   * second pass sees only what the first left behind.
   */
  async deleteBatched(table, timeColumn, cutoff, batchSize, anonymousOnly) {
    const scope = anonymousOnly ? "session_id IS NULL AND " : "";
    const sql = `
      DELETE FROM ${table}
       WHERE rowid IN (
         SELECT rowid FROM ${table}
          WHERE ${scope}${timeColumn} < ?
          LIMIT ?
       )`;
    let deleted = 0;
    for (; ; ) {
      const result = await this.d1.prepare(sql).bind(cutoff.toISOString(), batchSize).run();
      const changes = Number(result.meta.changes ?? 0);
      deleted += changes;
      if (changes < batchSize) {
        break;
      }
    }
    return deleted;
  }
  /** Configured window in days (>= 1), mirroring the pg service's env parsing. */
  configuredDays(envName, fallbackDays) {
    const raw2 = process.env[envName];
    if (raw2 === void 0 || raw2.trim() === "") {
      return fallbackDays;
    }
    const parsed = Number.parseInt(raw2, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallbackDays;
    }
    return parsed;
  }
};
__name(D1CalculationRecordRetentionService, "D1CalculationRecordRetentionService");
D1CalculationRecordRetentionService = __decorateClass([
  Injectable()
], D1CalculationRecordRetentionService);

// src/cron/retention-sweep.ts
var RETENTION_CRON = "30 3 * * *";
function parseDays(raw2) {
  if (raw2 === void 0 || raw2.trim() === "") return void 0;
  const parsed = Number.parseInt(raw2, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : void 0;
}
__name(parseDays, "parseDays");
async function handleRetentionSweep(env, log, deps = {}) {
  log.info({ message: "Starting daily calculation-record retention sweep" });
  const retentionDays = deps.retentionDays ?? parseDays(env.CALCULATION_RECORD_RETENTION_DAYS);
  const ageCapDays = deps.ageCapDays ?? parseDays(env.CALCULATION_RECORD_AGE_CAP_DAYS);
  const result = await (deps.service ?? new D1CalculationRecordRetentionService(env.DB)).runRetention({
    ...deps.now !== void 0 ? { now: deps.now } : {},
    ...retentionDays !== void 0 ? { retentionDays } : {},
    ...ageCapDays !== void 0 ? { ageCapDays } : {},
    ...deps.batchSize !== void 0 ? { batchSize: deps.batchSize } : {}
  });
  log.info({
    message: `Retention sweep finished: pruned anonymous ${Object.entries(result.prunedAnonymous).map(([table, count]) => `${table}=${count}`).join(" ")}, age-capped ${Object.entries(result.ageCapped).map(([table, count]) => `${table}=${count}`).join(" ")} (anonymous cutoff ${result.anonymousCutoff.toISOString()}, age-cap cutoff ${result.ageCapCutoff.toISOString()}, batch ${result.batchSize})`,
    prunedAnonymous: result.prunedAnonymous,
    ageCapped: result.ageCapped
  });
  return result;
}
__name(handleRetentionSweep, "handleRetentionSweep");

// src/queues/ingestion-producer.ts
init_modules_watch_stub();
var INGESTION_PRODUCER_CRON = "0 * * * *";
function ingestionDedupeKey(merchantId, at) {
  const hourBucket = at.toISOString().slice(0, 13).replace("T", "-");
  return `price-ingestion-${merchantId}-${hourBucket}`;
}
__name(ingestionDedupeKey, "ingestionDedupeKey");
function ingestionQueue(env) {
  if (!env.INGESTION_QUEUE) {
    throw new Error("INGESTION_QUEUE Queue binding is not configured");
  }
  return env.INGESTION_QUEUE;
}
__name(ingestionQueue, "ingestionQueue");
async function isMerchantPermitted(checkPermission, merchantId, log) {
  let result;
  try {
    result = await checkPermission(merchantId);
  } catch (err) {
    log.warn({
      message: `Not scheduling merchant "${merchantId}": governance check failed \u2014 defaulting to PENDING (${err instanceof Error ? err.message : String(err)})`
    });
    return false;
  }
  if (result.sources.length === 0) {
    log.warn({
      message: `Not scheduling merchant "${merchantId}": no governance records \u2014 defaulting to PENDING`
    });
    return false;
  }
  if (result.permissionStatus !== "GRANTED") {
    log.warn({
      message: `Not scheduling merchant "${merchantId}": permission status is ${result.permissionStatus}`
    });
    return false;
  }
  return true;
}
__name(isMerchantPermitted, "isMerchantPermitted");
async function schedulePriceIngestions(env, deps = {}) {
  const now = deps.now ?? /* @__PURE__ */ new Date();
  const log = deps.log ?? createLogger(env.LOG_LEVEL);
  const queue = deps.queue ?? ingestionQueue(env);
  const governance = composeGovernanceService();
  const checkPermission = deps.checkPermission ?? ((id) => governance.checkPermission(id));
  const registry = composeMerchantRegistry(env);
  const merchants = await registry.list();
  const counts = {
    merchants: merchants.length,
    enqueued: 0,
    skippedNoFeedUrl: 0,
    skippedNotPermitted: 0,
    enqueueErrors: 0
  };
  for (const merchant of merchants) {
    if (!merchant.feedUrl) {
      log.info({
        message: `Skipping merchant "${merchant.merchantId}": registry feed URL is empty`
      });
      counts.skippedNoFeedUrl++;
      continue;
    }
    if (!await isMerchantPermitted(checkPermission, merchant.merchantId, log)) {
      counts.skippedNotPermitted++;
      continue;
    }
    const body = {
      dedupeKey: ingestionDedupeKey(merchant.merchantId, now),
      merchantId: merchant.merchantId,
      sourceUrl: merchant.feedUrl
    };
    try {
      await queue.send(body);
      counts.enqueued++;
    } catch (err) {
      counts.enqueueErrors++;
      log.error({
        message: `Failed to enqueue price-ingestion message for merchant "${merchant.merchantId}": ` + (err instanceof Error ? err.message : String(err))
      });
    }
  }
  log.info({
    message: `Hourly price ingestion: enqueued ${counts.enqueued}/${merchants.length} registry merchant message(s) \u2014 one message per permitted merchant`,
    enqueued: counts.enqueued,
    merchants: merchants.length
  });
  return counts;
}
__name(schedulePriceIngestions, "schedulePriceIngestions");

// src/cron/router.ts
function cronRoutingTable() {
  const table = /* @__PURE__ */ new Map();
  const add = /* @__PURE__ */ __name((pattern, handler) => {
    const existing = table.get(pattern);
    if (existing) {
      existing.push(handler);
    } else {
      table.set(pattern, [handler]);
    }
  }, "add");
  add(INGESTION_PRODUCER_CRON, {
    name: "ingestion-producer",
    run: /* @__PURE__ */ __name((env, log) => schedulePriceIngestions(env, { log }), "run")
  });
  add(TRANSPORT_REFRESH_CRON, {
    name: "transport-rate-refresh",
    run: /* @__PURE__ */ __name((env, log) => handleTransportRateRefresh(env, log), "run")
  });
  add(TRANSPORT_REFRESH_CRON, {
    name: "click-counter-flush",
    run: /* @__PURE__ */ __name((env, log) => flushClickCounters(env).then((result) => {
      log.info({
        message: "Click-counter flush complete",
        snapshotTaken: result.snapshotTaken,
        rowsWritten: result.rowsWritten
      });
      return result;
    }), "run")
  });
  add(TAX_REVIEW_CRON, {
    name: "tax-dataset-review",
    run: /* @__PURE__ */ __name((env, log) => handleTaxDatasetReview(env, log), "run")
  });
  add(FX_REVIEW_CRON, {
    name: "fx-dataset-review",
    run: /* @__PURE__ */ __name((env, log) => handleFxDatasetReview(env, log), "run")
  });
  add(AGGREGATION_CRON, {
    name: "time-series-aggregation",
    run: /* @__PURE__ */ __name((env, log) => handleTimeSeriesAggregation(env, log), "run")
  });
  add(RETENTION_CRON, {
    name: "retention-sweep",
    run: /* @__PURE__ */ __name((env, log) => handleRetentionSweep(env, log), "run")
  });
  return table;
}
__name(cronRoutingTable, "cronRoutingTable");
function handlersForCron(cron) {
  return cronRoutingTable().get(cron) ?? [];
}
__name(handlersForCron, "handlersForCron");
function dispatchScheduled(event, env, ctx) {
  const log = createLogger(env.LOG_LEVEL);
  const handlers = handlersForCron(event.cron);
  if (handlers.length === 0) {
    log.warn({
      message: `No cron handler registered for pattern "${event.cron}"`,
      cron: event.cron
    });
    return;
  }
  runCronHandlers(handlers, event.cron, env, ctx, log);
}
__name(dispatchScheduled, "dispatchScheduled");
function runCronHandlers(handlers, cron, env, ctx, log) {
  for (const handler of handlers) {
    ctx.waitUntil(
      handler.run(env, log).then(() => {
        log.info({ message: `Cron handler "${handler.name}" complete`, cron });
      }).catch((err) => {
        log.error({
          message: `Cron handler "${handler.name}" failed`,
          cron,
          error: err instanceof Error ? err.message : "unknown error"
        });
      })
    );
  }
}
__name(runCronHandlers, "runCronHandlers");

// src/queues/ingestion.queue.ts
init_modules_watch_stub();

// src/workflows/handoff.ts
init_modules_watch_stub();
async function ensureWorkflowInstance(workflow, instanceId, params) {
  try {
    await workflow.get(instanceId);
    return { created: false, instanceId };
  } catch {
  }
  try {
    await workflow.create({ id: instanceId, params });
    return { created: true, instanceId };
  } catch (err) {
    try {
      await workflow.get(instanceId);
      return { created: false, instanceId };
    } catch {
      throw err;
    }
  }
}
__name(ensureWorkflowInstance, "ensureWorkflowInstance");

// src/queues/ingestion.queue.ts
async function runIngestionViaWorkflow(merchant, ctx) {
  if (!merchant.dedupeKey) {
    throw new Error(
      "Workflow handoff requires the message dedupeKey \u2014 it is the idempotent instance id"
    );
  }
  const workflow = ctx.env.INGESTION_WORKFLOW;
  if (!workflow) {
    throw new Error("INGESTION_WORKFLOW Workflow binding is not configured");
  }
  await ensureWorkflowInstance(workflow, merchant.dedupeKey, {
    dedupeKey: merchant.dedupeKey,
    merchantId: merchant.merchantId,
    sourceUrl: merchant.sourceUrl ?? ""
  });
  return { productsIngested: 0, errors: [], handedOff: true };
}
__name(runIngestionViaWorkflow, "runIngestionViaWorkflow");
async function processIngestionMessage(body, env, deps = {}) {
  const log = deps.log ?? createLogger(env.LOG_LEVEL);
  const claims = deps.claims ?? {
    claim: claimJob,
    release: releaseJob
  };
  const run = deps.run ?? runIngestionViaWorkflow;
  if (typeof body?.dedupeKey !== "string" || body.dedupeKey.length === 0 || typeof body?.merchantId !== "string" || body.merchantId.length === 0) {
    throw new Error(`Malformed ingestion message body: ${JSON.stringify(body)}`);
  }
  const outcome = await claims.claim(env, body.dedupeKey);
  if (outcome.status === "already-completed") {
    log.info({
      message: `Skipping ingestion ${body.dedupeKey}: already processed`,
      dedupeKey: body.dedupeKey
    });
    return { processed: false, skipped: true };
  }
  if (outcome.status === "in-flight") {
    log.info({
      message: `Skipping ingestion ${body.dedupeKey}: another delivery is in flight`,
      dedupeKey: body.dedupeKey
    });
    return { processed: false, skipped: true };
  }
  log.info({
    message: `Ingesting prices for merchant ${body.merchantId} (dedupe key ${body.dedupeKey})`,
    merchantId: body.merchantId,
    dedupeKey: body.dedupeKey,
    sourceUrl: body.sourceUrl
  });
  try {
    const result = await run(
      { merchantId: body.merchantId, sourceUrl: body.sourceUrl, dedupeKey: body.dedupeKey },
      { env, log }
    );
    if (result.handedOff === true) {
      log.info({
        message: `Handed off ingestion ${body.dedupeKey} to Workflow instance ${body.dedupeKey} \u2014 durable per-step retries; the instance completes the claim`,
        merchantId: body.merchantId,
        dedupeKey: body.dedupeKey
      });
    } else {
      log.info({
        message: `Ingested ${result.productsIngested} products for merchant ${body.merchantId}`,
        merchantId: body.merchantId,
        productsIngested: result.productsIngested,
        errorCount: result.errors.length
      });
      if (result.errors.length > 0) {
        log.warn({
          message: `Ingestion completed with ${result.errors.length} errors for merchant ${body.merchantId}`,
          merchantId: body.merchantId
        });
      }
    }
    return { processed: true, skipped: false };
  } catch (err) {
    await claims.release(env, body.dedupeKey);
    const message = err instanceof Error ? err.message : String(err);
    log.error({
      message: `Ingestion failed for merchant ${body.merchantId} \u2014 claim released, message will retry`,
      merchantId: body.merchantId,
      dedupeKey: body.dedupeKey,
      error: message
    });
    return { processed: false, skipped: false, error: message };
  }
}
__name(processIngestionMessage, "processIngestionMessage");
async function handleIngestionBatch(batch, env, deps) {
  for (const message of batch.messages) {
    const result = await processIngestionMessage(message.body, env, deps);
    if (result.skipped || result.processed) {
      message.ack();
    } else {
      message.retry({
        delaySeconds: retryDelaySeconds(message.attempts)
      });
    }
  }
}
__name(handleIngestionBatch, "handleIngestionBatch");
function retryDelaySeconds(attemptsMade) {
  return Math.min(30 * 2 ** attemptsMade, 7200);
}
__name(retryDelaySeconds, "retryDelaySeconds");

// src/do/rate-limiter.do.ts
init_modules_watch_stub();
var WINDOW_PREFIX = "w:";
function windowStorageKey(profile) {
  return `${WINDOW_PREFIX}${profile}`;
}
__name(windowStorageKey, "windowStorageKey");
var RateLimiterDO = class {
  constructor(state, _env) {
    this.state = state;
  }
  state;
  static {
    __name(this, "RateLimiterDO");
  }
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    try {
      switch (body.op) {
        case "check":
          return Response.json(await this.check(body.profile, body.limit, body.windowMs, body.nowMs));
        case "remaining":
          return Response.json({
            remaining: await this.remaining(body.profile, body.limit, body.windowMs, body.nowMs)
          });
        case "resetAt":
          return Response.json({
            resetAtMs: await this.resetAt(body.profile, body.windowMs, body.nowMs)
          });
        default:
          return Response.json({ error: "unknown op" }, { status: 400 });
      }
    } catch (err) {
      if (err instanceof RangeError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }
  /**
   * Atomic admission: prune, decide, record. Single round trip returns
   * the full decision so callers never need a second DO fetch for
   * Retry-After.
   */
  async check(profile, limit, windowMs, nowMs) {
    assertPositive(limit, "limit");
    assertPositive(windowMs, "windowMs");
    const now = nowMs ?? Date.now();
    const key = windowStorageKey(profile);
    const log = await this.loadWindow(key, now, windowMs);
    if (log.length >= limit) {
      const resetAtMs2 = oldestPlusWindow(log, now, windowMs);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAtMs: resetAtMs2,
        retryAfterSeconds: retryAfter(resetAtMs2, now)
      };
    }
    log.push(now);
    await this.state.storage.put(key, log);
    const resetAtMs = oldestPlusWindow(log, now, windowMs);
    return {
      allowed: true,
      limit,
      remaining: limit - log.length,
      resetAtMs,
      retryAfterSeconds: 0
    };
  }
  /** Active count (lazy-pruned) against the limit. */
  async remaining(profile, limit, windowMs, nowMs) {
    assertPositive(limit, "limit");
    assertPositive(windowMs, "windowMs");
    const now = nowMs ?? Date.now();
    const key = windowStorageKey(profile);
    const log = await this.loadWindow(key, now, windowMs);
    return Math.max(0, limit - log.length);
  }
  /** Oldest active hit + window; `now + window` when empty (Redis parity). */
  async resetAt(profile, windowMs, nowMs) {
    assertPositive(windowMs, "windowMs");
    const now = nowMs ?? Date.now();
    const log = await this.loadWindow(windowStorageKey(profile), now, windowMs);
    return oldestPlusWindow(log, now, windowMs);
  }
  /**
   * Load the profile's window log with lazy pruning: drop hits at or
   * before `now − windowMs`, persist the pruned log, return it. This is
   * the DO counterpart of the Lua script's ZREMRANGEBYSCORE.
   */
  async loadWindow(key, now, windowMs) {
    const stored = await this.state.storage.get(key);
    if (stored === void 0) {
      return [];
    }
    const cutoff = now - windowMs;
    const active = stored.filter((t) => t > cutoff);
    if (active.length !== stored.length) {
      await this.state.storage.put(key, active);
    }
    return active;
  }
};
function oldestPlusWindow(log, now, windowMs) {
  const oldest = log[0];
  return oldest !== void 0 ? oldest + windowMs : now + windowMs;
}
__name(oldestPlusWindow, "oldestPlusWindow");
function retryAfter(resetAtMs, now) {
  return Math.max(0, Math.ceil((resetAtMs - now) / 1e3));
}
__name(retryAfter, "retryAfter");
function assertPositive(value, name) {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a finite number >= 1`);
  }
}
__name(assertPositive, "assertPositive");

// src/do/click-counter.do.ts
init_modules_watch_stub();
var DEFAULT_FLUSH_INTERVAL_MS = 216e5;
var TOTAL_PREFIX = "t:";
var DELTA_PREFIX = "d:";
var PENDING_KEY = "p:snapshot";
var INTERVAL_KEY = "cfg:intervalMs";
function pairKey(prefix, merchantId, url) {
  return `${prefix}${JSON.stringify([merchantId, url])}`;
}
__name(pairKey, "pairKey");
function parsePairKey(prefix, key) {
  const [merchantId, url] = JSON.parse(key.slice(prefix.length));
  return [merchantId, url];
}
__name(parsePairKey, "parsePairKey");
var ClickCounterDO = class {
  constructor(state, _env) {
    this.state = state;
  }
  state;
  static {
    __name(this, "ClickCounterDO");
  }
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    try {
      switch (body.op) {
        case "increment":
          return Response.json({
            total: await this.increment(
              body.merchantId,
              body.url,
              body.by,
              body.flushIntervalMs,
              body.nowMs
            )
          });
        case "counts":
          return Response.json({ counts: await this.counts() });
        case "drain":
          return Response.json({ snapshot: await this.drain(body.nowMs) });
        default:
          return Response.json({ error: "unknown op" }, { status: 400 });
      }
    } catch (err) {
      if (err instanceof RangeError) {
        return Response.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }
  /**
   * Alarm tick: harvest the deltas into the pending snapshot payload and
   * reschedule one interval out. workerd clears the alarm before invoking
   * it, so re-arming here is unconditional (same pattern as IdempotencyDO).
   */
  async alarm() {
    const now = Date.now();
    await this.harvest(now);
    await this.state.storage.setAlarm(now + await this.flushInterval());
  }
  // -----------------------------------------------------------------------
  // Ops
  // -----------------------------------------------------------------------
  /**
   * Exact, persisted increment of one (merchant, url) counter — both the
   * cumulative total and the open delta. Single DO event; input gates
   * make read-modify-write atomic against concurrent requests. Arms the
   * alarm when none is pending so captures happen even if traffic stops.
   */
  async increment(merchantId, url, by, flushIntervalMs, nowMs) {
    assertNonEmpty(merchantId, "merchantId");
    assertNonEmpty(url, "url");
    const step = assertPositiveInteger(by ?? 1, "by");
    if (flushIntervalMs !== void 0) {
      assertPositiveInteger(flushIntervalMs, "flushIntervalMs");
      await this.state.storage.put(INTERVAL_KEY, flushIntervalMs);
    }
    const now = nowMs ?? Date.now();
    const totalKey = pairKey(TOTAL_PREFIX, merchantId, url);
    const deltaKey = pairKey(DELTA_PREFIX, merchantId, url);
    const total = (await this.state.storage.get(totalKey) ?? 0) + step;
    const delta = (await this.state.storage.get(deltaKey) ?? 0) + step;
    await this.state.storage.put(totalKey, total);
    await this.state.storage.put(deltaKey, delta);
    await this.armAlarm(now);
    return total;
  }
  /**
   * Cumulative counts as `Record<merchantId, Record<url, count>>` —
   * getClickCounts parity with the Redis service (full URLs, no hash
   * fields, no reverse map).
   */
  async counts() {
    const result = {};
    for (const [key, count] of await this.listPairs(TOTAL_PREFIX)) {
      const [merchantId, url] = parsePairKey(TOTAL_PREFIX, key);
      (result[merchantId] ??= {})[url] = count;
    }
    return result;
  }
  /**
   * Harvest the open deltas into the pending payload, then hand the
   * payload to the caller and clear it — the worker-side flusher's entry
   * point. Returns null when nothing was clicked since the last capture.
   */
  async drain(nowMs) {
    const now = nowMs ?? Date.now();
    await this.harvest(now);
    const pending = await this.state.storage.get(PENDING_KEY);
    if (pending === void 0) {
      return null;
    }
    await this.state.storage.delete(PENDING_KEY);
    return pending;
  }
  // -----------------------------------------------------------------------
  // Capture choreography
  // -----------------------------------------------------------------------
  /**
   * Move the open deltas into the pending snapshot: one row per pair
   * carrying its *cumulative* total at `now` (the archive convention that
   * makes re-running a capture idempotent on the D1 unique key). A
   * not-yet-taken pending payload is merged in place — its rows update
   * monotonically and its capture instant refreshes; no count is ever
   * duplicated because deltas are deleted, not re-read.
   */
  async harvest(now) {
    const deltas = await this.listPairs(DELTA_PREFIX);
    if (deltas.size === 0) {
      return;
    }
    const pending = await this.state.storage.get(PENDING_KEY) ?? {
      capturedAt: new Date(now).toISOString(),
      rows: []
    };
    const byPair = new Map(
      pending.rows.map((row) => [pairKey("", row.merchantId, row.url), row])
    );
    for (const [deltaKey, delta] of deltas) {
      await this.state.storage.delete(deltaKey);
      if (delta === 0) continue;
      const [merchantId, url] = parsePairKey(DELTA_PREFIX, deltaKey);
      const clickCount = await this.state.storage.get(pairKey(TOTAL_PREFIX, merchantId, url)) ?? 0;
      byPair.set(pairKey("", merchantId, url), { merchantId, url, clickCount });
    }
    const rows = [...byPair.values()].sort(
      (a, b) => a.merchantId.localeCompare(b.merchantId) || a.url.localeCompare(b.url)
    );
    await this.state.storage.put(PENDING_KEY, {
      capturedAt: new Date(now).toISOString(),
      rows
    });
  }
  /** Point the alarm one interval out unless one is already armed. */
  async armAlarm(now) {
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(now + await this.flushInterval());
    }
  }
  /** Persisted flush interval, or the legacy 6 h default. */
  async flushInterval() {
    return await this.state.storage.get(INTERVAL_KEY) ?? DEFAULT_FLUSH_INTERVAL_MS;
  }
  /** All `prefix:`-keys with their numeric values. */
  async listPairs(prefix) {
    const options = { prefix };
    const entries = await this.state.storage.list(options);
    const numbers = /* @__PURE__ */ new Map();
    for (const [key, value] of entries) {
      if (typeof value === "number") numbers.set(key, value);
    }
    return numbers;
  }
};
function assertNonEmpty(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${name} must be a non-empty string`);
  }
}
__name(assertNonEmpty, "assertNonEmpty");
function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer >= 1`);
  }
  return value;
}
__name(assertPositiveInteger, "assertPositiveInteger");

// src/workflows/index.ts
init_modules_watch_stub();

// src/workflows/ingestion.workflow.ts
init_modules_watch_stub();
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

// src/workflows/ingestion-steps.ts
init_modules_watch_stub();
var INGESTION_STEP_RETRY = {
  retries: { limit: 5, delay: 3e4, backoff: "exponential" }
};
function composeIngestionStageServices(env, options = {}) {
  const fxDatasets = new FxRateDatasetService(
    new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB))
  );
  const adapters = options.feedAdaptersOverride ?? (() => {
    const map = /* @__PURE__ */ new Map();
    const systembolaget = new SystembolagetFeedAdapter(fxDatasets);
    const alko = new AlkoFeedAdapter();
    map.set(systembolaget.merchantId, systembolaget);
    map.set(alko.merchantId, alko);
    return map;
  })();
  const upsertRepository = options.upsertRepositoryOverride ?? new D1UpsertRepository(env.DB);
  const governance = new SourceGovernanceService(
    options.governanceRepository ?? new InMemorySourceGovernanceRepository()
  );
  const recorder = new PriceObservationRecorderService(
    new ClassificationGateService(),
    new AlcoholExciseService(new D1TaxRuleRepositoryAdapter(env.DB)),
    new ContainerDutyService(new D1TaxRuleRepositoryAdapter(env.DB)),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(env.DB))
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(env.DB)),
    new R2PriceObservationPort(
      options.observationStoreOverride ?? observationLogStore(env)
    )
  );
  return {
    registry: new D1MerchantRegistryRepository(env.DB),
    governance,
    feeds: new FeedIngestionService(adapters),
    mapping: new DataMappingService(),
    contentLint: new ContentLintService(),
    upserts: upsertRepository,
    dataQuality: new DataQualityService(new ReliabilityService()),
    offerChangeHook: new OfferChangeRecorderHook(recorder)
  };
}
__name(composeIngestionStageServices, "composeIngestionStageServices");
async function resolveMerchantStep(registry, params) {
  const row = await registry.findByMerchantId(params.merchantId);
  if (row === null) {
    return {
      kind: "error",
      message: `Merchant "${params.merchantId}" is not in the merchant registry \u2014 onboard it (registry row + governance grant) before ingestion (D6)`
    };
  }
  const derived = merchantConfigFromRegistry(row);
  if ("error" in derived) {
    return { kind: "error", message: derived.error };
  }
  return { kind: "ok", config: derived.config };
}
__name(resolveMerchantStep, "resolveMerchantStep");
async function governanceGateStep(governance, merchantId) {
  let result;
  try {
    result = await governance.checkPermission(merchantId);
  } catch {
    return {
      permitted: false,
      status: "PENDING",
      reason: "Governance check error \u2014 defaulting to PENDING"
    };
  }
  if (result.sources.length === 0) {
    return {
      permitted: false,
      status: "PENDING",
      reason: "No governance records found \u2014 defaulting to PENDING"
    };
  }
  if (result.permissionStatus === "GRANTED") {
    return { permitted: true, status: "GRANTED", reason: "Permission granted" };
  }
  return {
    permitted: false,
    status: result.permissionStatus,
    reason: `Permission status is ${result.permissionStatus}`
  };
}
__name(governanceGateStep, "governanceGateStep");
async function fetchFeedStep(feeds, config) {
  const result = await feeds.fetchFromMerchant(
    config.merchantId,
    config.feedUrl,
    config.feedFormat
  );
  return { records: result.records, errors: result.errors };
}
__name(fetchFeedStep, "fetchFeedStep");
async function mapRecordsStep(services, config, fetched) {
  const mapped = services.mapping.mapBatch(
    [...fetched.records],
    config.merchantId,
    config.country
  );
  const contentViolations = [];
  for (const pair of mapped) {
    const result = services.contentLint.lintProductContent(
      pair.product.name,
      ""
      // description — not available in Phase 1 feed data
    );
    contentViolations.push(...result.violations);
  }
  return {
    pairs: mapped.map((pair) => {
      const { observedAt, ...offerRest } = pair.offerInput;
      return {
        product: pair.product,
        offerInput: { ...offerRest, observedAtIso: observedAt.toISOString() }
      };
    }),
    contentViolations
  };
}
__name(mapRecordsStep, "mapRecordsStep");
async function upsertOffersStep(services, config, mapped) {
  let recordsAdded = 0;
  let recordsUpdated = 0;
  let offersChanged = 0;
  const upsertErrors = [];
  const upsertedOffers = [];
  for (const pair of mapped.pairs) {
    try {
      const upsertResult = await services.upserts.upsertProduct(pair.product);
      if (upsertResult.created) {
        recordsAdded++;
      } else {
        recordsUpdated++;
      }
      const observedAt = new Date(pair.offerInput.observedAtIso);
      const { observedAtIso: _serialized, ...offerRest } = pair.offerInput;
      const offerResult = await services.upserts.upsertOffer({
        ...offerRest,
        observedAt,
        productId: upsertResult.productId
      });
      upsertedOffers.push({
        merchant: config.merchantId,
        productId: upsertResult.productId,
        observedAtIso: pair.offerInput.observedAtIso,
        reliabilityStatus: pair.offerInput.reliabilityStatus
      });
      if (offerResult.changed) {
        offersChanged++;
        if (services.offerChangeHook) {
          try {
            await services.offerChangeHook.onOfferChanged({
              productId: upsertResult.productId,
              offerId: offerResult.offerId,
              merchant: config.merchantId,
              country: pair.offerInput.country,
              priceCents: pair.offerInput.priceCents,
              reliabilityStatus: pair.offerInput.reliabilityStatus,
              observedAt
            });
          } catch (hookErr) {
            const message = hookErr instanceof Error ? hookErr.message : "Unknown offer-change hook error";
            void message;
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown upsert error";
      upsertErrors.push(
        `Failed to upsert product "${pair.product.name}": ${message}`
      );
    }
  }
  return { recordsAdded, recordsUpdated, offersChanged, upsertErrors, upsertedOffers };
}
__name(upsertOffersStep, "upsertOffersStep");
async function dataQualityStep(services, upserted) {
  if (upserted.length === 0) return null;
  return services.dataQuality.runQualityCheck(
    upserted.map((offer) => ({
      merchant: offer.merchant,
      productId: offer.productId,
      observedAt: new Date(offer.observedAtIso),
      reliabilityStatus: offer.reliabilityStatus
    }))
  );
}
__name(dataQualityStep, "dataQualityStep");
async function runIngestionWorkflow(params, deps) {
  const { step, env, NonRetryableError: NonRetryableError2 } = deps;
  const log = deps.log;
  const claims = deps.claims ?? {
    complete: completeJob,
    release: releaseJob
  };
  if (typeof params?.dedupeKey !== "string" || params.dedupeKey.length === 0 || typeof params?.merchantId !== "string" || params.merchantId.length === 0) {
    throw new NonRetryableError2(
      `Malformed ingestion workflow params: ${JSON.stringify(params)}`
    );
  }
  const services = deps.services ?? composeIngestionStageServices(env, deps.stageOptions);
  const finalize = /* @__PURE__ */ __name(async (result) => {
    await step.do(
      "complete-job-claim",
      INGESTION_STEP_RETRY,
      () => claims.complete(env, params.dedupeKey)
    );
    return result;
  }, "finalize");
  try {
    const resolved = await step.do(
      "resolve-merchant",
      INGESTION_STEP_RETRY,
      () => resolveMerchantStep(services.registry, params)
    );
    if (resolved.kind === "error") {
      log?.error({ message: resolved.message, merchantId: params.merchantId });
      return await finalize({ productsIngested: 0, errors: [resolved.message] });
    }
    const config = resolved.config;
    const gate = await step.do(
      "governance-gate",
      INGESTION_STEP_RETRY,
      () => governanceGateStep(services.governance, config.merchantId)
    );
    if (!gate.permitted) {
      log?.warn({
        message: `Skipping merchant "${config.merchantId}": ${gate.reason}`,
        merchantId: config.merchantId
      });
      return await finalize({ productsIngested: 0, errors: [] });
    }
    const fetched = await step.do(
      "fetch-feed",
      INGESTION_STEP_RETRY,
      () => fetchFeedStep(services.feeds, config)
    );
    if (fetched.errors.length > 0) {
      log?.warn({
        message: `Fetch warnings/errors for "${config.merchantId}": ${fetched.errors.join("; ")}`,
        merchantId: config.merchantId
      });
    }
    if (fetched.records.length === 0) {
      return await finalize({
        productsIngested: 0,
        errors: [...fetched.errors]
      });
    }
    const mapped = await step.do(
      "map-records",
      INGESTION_STEP_RETRY,
      () => mapRecordsStep(services, config, fetched)
    );
    if (mapped.contentViolations.length > 0) {
      log?.warn({
        message: `Content violations for "${config.merchantId}": ${mapped.contentViolations.length} found`,
        merchantId: config.merchantId
      });
    }
    const upserts = await step.do(
      "upsert-offers",
      INGESTION_STEP_RETRY,
      () => upsertOffersStep(services, config, mapped)
    );
    await step.do(
      "data-quality",
      INGESTION_STEP_RETRY,
      () => dataQualityStep(services, upserts.upsertedOffers)
    );
    log?.info({
      message: `Workflow pipeline run for "${config.merchantId}": ${fetched.records.length} fetched, ${upserts.recordsAdded} added, ${upserts.recordsUpdated} updated, ${upserts.offersChanged} offers changed, ${upserts.upsertErrors.length} upsert errors`,
      merchantId: config.merchantId,
      dedupeKey: params.dedupeKey
    });
    return await finalize({
      productsIngested: upserts.recordsAdded + upserts.recordsUpdated,
      errors: [...fetched.errors, ...upserts.upsertErrors]
    });
  } catch (err) {
    await step.do(
      "release-job-claim",
      INGESTION_STEP_RETRY,
      () => claims.release(env, params.dedupeKey)
    );
    throw err;
  }
}
__name(runIngestionWorkflow, "runIngestionWorkflow");

// src/workflows/ingestion.workflow.ts
var IngestionWorkflow = class extends WorkflowEntrypoint {
  static {
    __name(this, "IngestionWorkflow");
  }
  async run(event, step) {
    return runIngestionWorkflow(event.payload, {
      env: this.env,
      step,
      NonRetryableError
    });
  }
};

// src/index.ts
function createApp() {
  const app2 = new Hono2();
  app2.use(requestLogging());
  app2.onError((err, c) => respondToError(c, err));
  app2.use(errorBoundary());
  app2.notFound((c) => {
    const { status, body } = routeNotFoundResponse(
      c.req.method,
      requestPath(c)
    );
    return c.json(body, status);
  });
  app2.get("/api/v1/health", (c) => {
    return c.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app2.use("/api/v1/calculator/*", requireRateLimit("CALCULATOR"));
  app2.use("/api/v1/calculations/*", requireRateLimit("CALCULATOR"));
  app2.use("/api/v1/basket/*", requireRateLimit("BASKET"));
  app2.use("/api/v1/products/:id/price-history", requireRateLimit("HISTORICAL"));
  app2.use("/api/v1/reports/*", requireRateLimit("DECLARATION"));
  registerGuardMiddleware(app2);
  registerCalculatorRoutes(app2);
  registerSearchRoutes(app2);
  registerDeclarationRoutes(app2);
  registerBasketRoutes(app2);
  registerHistoricalRoutes(app2);
  registerReportsRoutes(app2);
  registerMerchantsRoutes(app2);
  registerAccountsRoutes(app2);
  registerAnalyticsRoutes(app2);
  registerOpsRoutes(app2);
  return app2;
}
__name(createApp, "createApp");
var app = createApp();
var src_default = {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    dispatchScheduled(event, env, ctx);
  },
  async queue(batch, env) {
    await handleIngestionBatch(batch, env);
  }
};

// ../../node_modules/.pnpm/wrangler@4.127.1_@cloudflare+workers-types@5.20260830.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
init_modules_watch_stub();
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.127.1_@cloudflare+workers-types@5.20260830.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
init_modules_watch_stub();
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Mi9oms/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.127.1_@cloudflare+workers-types@5.20260830.1/node_modules/wrangler/templates/middleware/common.ts
init_modules_watch_stub();
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Mi9oms/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ApiHttpError,
  ClickCounterDO,
  IdempotencyDO,
  IngestionWorkflow,
  RateLimiterDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  createApp,
  middleware_loader_entry_default as default
};
/*! Bundled license information:

reflect-metadata/Reflect.js:
  (*! *****************************************************************************
  Copyright (C) Microsoft. All rights reserved.
  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at http://www.apache.org/licenses/LICENSE-2.0
  
  THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
  WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
  MERCHANTABLITY OR NON-INFRINGEMENT.
  
  See the Apache Version 2.0 License for specific language governing permissions
  and limitations under the License.
  ***************************************************************************** *)
*/
//# sourceMappingURL=index.js.map
