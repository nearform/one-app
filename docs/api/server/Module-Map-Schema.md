[👈 Return to Overview](../API.md)

# Module Map Schema

[**Holocron Modules**](../API.md#modules) may be developed and versioned in isolation as if they were their own frontend applications. The `one-app` Server relies on a `module-map.json` configuration file to orchestrate all these versioned web experiences together to form a single application. A Module Map contains an object of the following information:

* Holocron Module Name
* URLs to Holocron Module Bundles
* [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) Hash to verify contents of the Holocron Module Bundle

## Shape

```js
({
  key: String, // required
  modules: {
    [moduleName]: { // required
      browser: {
        url: String, // required
        integrity: String, // SRI String required
      },
      legacyBrowser: {
        url: String, // required
        integrity: String, // SRI String required
      },
      node: {
        url: String, // required
        integrity: String, // SRI String required
      },
    },
    // ... more module entries allowed
  },
});
```

### `key` Field

This key may be used to bust the caching of Modules in the [Holocron Module Registry].

### `[moduleName]` Field

By convention, the `moduleName` is the key mapping where Holocron Module bundles are stored in the [Holocron Module Registry].

### `browser` Field

### `legacyBrowser` Field

### `node` Field

### `url` Field

### `integrity` Field


[☝️ Return To Top](#module-map)

[Holocron Module Registry]: https://github.com/americanexpress/holocron/blob/master/packages/holocron/API.md#module-registry