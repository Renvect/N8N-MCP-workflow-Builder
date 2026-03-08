
const { startApiServer } = require('./dist/api-server');

const mockStore = {
    get: (key) => {
        if (key === 'n8nUrl') return '';
        if (key === 'n8nAuthType') return 'none';
        return '';
    }
};

console.log('Starting parallel middleware on port ' + (process.env.API_PORT || 3456));
startApiServer(mockStore).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
