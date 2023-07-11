import { exec } from 'child_process';
import { Resolver } from 'dns/promises';
import { Counter, Logger } from '@hydrooj/utils';

const resolver = new Resolver();
resolver.setServers(['114.114.114.114', '8.8.8.8']);
const logger = new Logger('proxy');
const fails = Counter();
function createProxy(target: string, targetPort: string) {
    logger.info('Proxy to', target);
    const child = exec(`ssh -R 0.0.0.0:${targetPort}:127.0.0.1:2333 root@${target}.hydro.ac`);
    child.stderr!.on('data', (data) => {
        if (!data.toString().includes('remote port forwarding failed for listen port')) return;
        logger.info(`Kill old ssh process on ${target}`);
        child.stdin!.write('fuser -k 2333/tcp\n');
    });
    let token = '';
    child.stdout!.on('data', (data) => {
        const s = data.toString();
        if (s.includes(token)) token = '';
        if (s.includes('Welcome')) {
            fails[target] = 0;
            logger.success(`Connected to ${target}`);
        }
        if (s.includes('fuser') && s.includes('command not found')) {
            logger.info(`Installing fuser on ${target}`);
            child.stdin!.write('apt-get update && apt-get install fuser -y -q\nfuser -k 2333/tcp');
        }
        if (s.startsWith('2333/tcp:')) child.kill();
    });
    const interval = setInterval(() => {
        if (token) child.kill();
        else {
            token = Math.random().toString();
            child.stdin!.write(`echo ${token}\n`);
        }
    }, 60000);
    child.on('exit', (code, signal) => {
        if (fails[target] % 10 === 9) global.sendMessage?.(`Proxy to ${target} failed after 10 retries.`);
        fails[target]++;
        logger.warn(`Proxy process to ${target} exited with code ${code}, signal ${signal}`);
        clearInterval(interval);
        setTimeout(() => createProxy(target, targetPort), 1000);
    });
}

async function main() {
    const [[result]] = await resolver.resolveTxt('alias.hydro.ac');
    const aliases = result.split(' ').filter(i => i);
    console.log(aliases);
    for (const r of aliases) createProxy(r, process.argv[2]);
}
main();
