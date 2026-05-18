// preload.js — intentionally minimal, no node APIs exposed to renderer
// The app runs entirely as a web page talking to localhost:8000
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('optilearn', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform,
})
