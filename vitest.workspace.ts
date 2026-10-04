// One test run over every workspace member. Each app's tests run under that
// app's own Vite config (its plugins, aliases and global setup); a package has
// no config of its own and runs under Vite's defaults.
export default ['apps/notes/vite.config.ts', 'apps/soundscapes/vite.config.ts', 'packages/*']
