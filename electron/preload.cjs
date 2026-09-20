const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('conexum', {
  platform: 'desktop',
  ssh: {
    connect: (request) => ipcRenderer.invoke('ssh:connect', request),
    write: (sessionId, data) => ipcRenderer.send('ssh:input', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send('ssh:resize', { sessionId, cols, rows }),
    disconnect: (sessionId) => ipcRenderer.send('ssh:disconnect', { sessionId }),
    getTelemetry: (sessionId) => ipcRenderer.invoke('ssh:telemetry', { sessionId }),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ssh:data', listener)
      return () => ipcRenderer.removeListener('ssh:data', listener)
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('ssh:exit', listener)
      return () => ipcRenderer.removeListener('ssh:exit', listener)
    },
  },
  profiles: {
    chooseIdentityFile: () => ipcRenderer.invoke('profiles:choose-identity'),
    importSshConfig: () => ipcRenderer.invoke('profiles:import-config'),
    forgetIdentityPassphrase: (filePath) => ipcRenderer.invoke('profiles:forget-identity', filePath),
  },
})
