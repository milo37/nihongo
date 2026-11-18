// #1100: better-auth lists vitest as an optional peer for its test-utils
// entry, which the API never imports. Because apps/api has vitest as a dev
// dependency, pnpm linked it under better-auth, so the production tree carried
// vitest, vite and picomatch. Dropping that one peer keeps test tooling out of
// the production tree for good, whatever picomatch version ships later.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'better-auth' && pkg.peerDependencies) {
        delete pkg.peerDependencies.vitest
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.vitest
      }
      return pkg
    }
  }
}
