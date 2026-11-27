const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

if (process.platform === 'win32') {
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET')
  const compiler = ['Framework64', 'Framework'].map(directory =>
    path.join(framework, directory, 'v4.0.30319', 'csc.exe')
  ).find(candidate => fs.existsSync(candidate))
  if (!compiler) throw new Error('The Windows .NET Framework C# compiler is required to build the SFTP sign-in dialog.')
  const root = path.resolve(__dirname, '..')
  const source = path.join(root, 'native/windows/ConexumSshAskpass.cs')
  const output = path.join(root, 'out/windows/ConexumSshAskpass.exe')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  execFileSync(compiler, ['/nologo', '/target:winexe', '/optimize+', '/utf8output', '/codepage:65001',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/out:' + output, source],
  { stdio: 'inherit', windowsHide: true })
}
