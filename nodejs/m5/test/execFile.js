import { execFile } from 'node:child_process';

execFile('C:\\Program Files\\Git\\bin\\bash.exe', ['-c', 'ls'], (err, stdout) => {
  console.log(stdout);
});