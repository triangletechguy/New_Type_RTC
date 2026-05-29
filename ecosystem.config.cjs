module.exports = {
  apps: [
    {
      name: 'rtc-backend',
      cwd: './backend',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: '8000',
      },
    },
  ],
}
