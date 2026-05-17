module.exports = {
  apps: [{
    name: 'constructai-web',
    cwd: '/root/constructai',
    script: 'npx',
    args: 'serve dist -l 3002',
    env: {
      NODE_ENV: 'production',
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    log_file: '/var/log/pm2/constructai-web.log',
    out_file: '/var/log/pm2/constructai-web-out.log',
    error_file: '/var/log/pm2/constructai-web-error.log',
  }]
};
