import { exec } from 'child_process';
import { Resolver } from 'dns/promises';
import { Counter, fs, Logger } from '@hydrooj/utils';

const resolver = new Resolver();
resolver.setServers(['114.114.114.114', '8.8.8.8']);
const logger = new Logger('proxy');
const fails = Counter();
function createProxy(target: string, targetPort: string, local: string) {
    const identifer = target + ':' + targetPort;
    let stop = false;
    logger.info('Proxy to', identifer);
    const child = exec(`ssh -tt -R 127.0.0.1:${targetPort}:${local} root@${target}.hydro.ac`);
    child.stderr!.on('data', (data) => {
        console.log(target + '/' + targetPort + ':' + data.toString());
        if (!data.toString().includes('remote port forwarding failed for listen port')) return;
        logger.info(`Kill old ssh process on ${identifer}`);
        child.stdin!.write(`fuser -k ${targetPort}/tcp\n`);
    });
    let token = '';
    child.stdout!.on('data', (data) => {
        const s = data.toString();
        console.log(target + '/' + targetPort + ':' + s);
        if (s.includes(token)) token = '';
        if (s.includes('Welcome')) {
            fails[identifer] = 0;
            logger.success(`Connected to ${identifer}`);
        }
        if (s.includes('fuser') && s.includes('command not found')) {
            logger.info(`Installing fuser on ${target}`);
            child.stdin!.write(`apt-get update && apt-get install fuser -y -q\nfuser -k ${targetPort}/tcp`);
        }
        if (s.startsWith(`${targetPort}/tcp:`)) child.kill();
    });
    const interval = setInterval(() => {
        if (token) child.kill();
        else {
            token = Math.random().toString();
            child.stdin!.write(`echo ${token}\n`);
        }
    }, 60000);
    child.on('exit', (code, signal) => {
        if (stop) return;
        if (fails[identifer] % 10 === 9) global.sendMessage?.(`Proxy to ${identifer} failed after 10 retries.`);
        fails[identifer]++;
        logger.warn(`Proxy process to ${identifer} exited with code ${code}, signal ${signal}`);
        clearInterval(interval);
        setTimeout(() => createProxy(target, targetPort, local), 1000);
    });
    return () => {
        stop = true;
        child.kill();
    }
}

function initAllProxy(expr: string, target: string) {
    const tasks = expr.split(',');
    const clean: (() => void)[] = [];
    for (const task of tasks) {
        const [l, r] = task.split('->');
        clean.push(createProxy(target, l, r));
    }
    return () => {
        for (const f of clean) f();
    }
}

async function main(expr: string) {
    expr = expr.trim();
    const map = {};
    const [[result]] = await resolver.resolveTxt('alias.hydro.ac');
    let aliases = result.split(' ').filter(i => i);
    console.log(aliases);
    for (const r of aliases) map[r] = initAllProxy(expr, r);
    setInterval(async () => {
        try {
            const [[result]] = await resolver.resolveTxt('alias.hydro.ac');
            const newAliases = result.split(' ').filter(i => i);
            console.log(newAliases);
            for (const r of newAliases) {
                if (map[r]) continue;
                map[r] = initAllProxy(expr, r);
                logger.info('New alias', r);
            }
            for (const r of aliases) {
                if (newAliases.includes(r)) continue;
                map[r]();
                delete map[r];
                logger.info('Alias removed', r);
            }
            aliases = newAliases;
        } catch (e) {
            logger.warn('Failed to resolve alias.hydro.ac');
        }
    }, 60000);
}

const alt = fs.existsSync('config') ? fs.readFileSync('config', 'utf-8') : '';
if (!process.argv[2] && !alt) logger.error("Usage: forward '2333->192.168.1.1:2333,2334->192.168.1.1:2444' (remote->local)");
else main(process.argv[2] || alt);
