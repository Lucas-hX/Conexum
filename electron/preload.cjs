const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
  sftp: {
    list: (sessionId, remotePath) => ipcRenderer.invoke('sftp:list', { sessionId, remotePath }),
    mutate: (sessionId, operation, sourcePath, destinationPath) => ipcRenderer.invoke('sftp:mutate', { sessionId, operation, sourcePath, destinationPath }),
    chooseUpload: () => ipcRenderer.invoke('sftp:choose-upload'),
    grantDroppedUpload: (file) => ipcRenderer.invoke('sftp:grant-dropped-upload', webUtils.getPathForFile(file)),
    chooseDownload: (suggestedName) => ipcRenderer.invoke('sftp:choose-download', suggestedName),
    transfers: (sessionId) => ipcRenderer.invoke('sftp:transfers', { sessionId }),
    enqueueTransfer: (request) => ipcRenderer.invoke('sftp:enqueue-transfer', request),
    retryTransfer: (transferId) => ipcRenderer.invoke('sftp:retry-transfer', { transferId }),
    cancelTransfer: (transferId) => ipcRenderer.send('sftp:cancel-transfer', { transferId }),
    onTransferProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('sftp:transfer-progress', listener)
      return () => ipcRenderer.removeListener('sftp:transfer-progress', listener)
    },
  },
})
