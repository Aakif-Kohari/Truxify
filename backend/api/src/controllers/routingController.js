const osrmService = require('../services/osrmService');

const getRoute = async (req, res) => {
    try {
        const { startLon, startLat, endLon, endLat } = req.query;

        if (!startLon || !startLat || !endLon || !endLat) {
            return res.status(400).json({
                error: 'Missing coordinates',
                message: 'startLon, startLat, endLon, and endLat are required'
            });
        }

        const route = await osrmService.getRouteWithResilience(
            parseFloat(startLon),
            parseFloat(startLat),
            parseFloat(endLon),
            parseFloat(endLat)
        );

        return res.status(200).json({
            success: true,
            data: route,
        });
    } catch (error) {
        console.error('Routing controller error:', error.message);
        return res.status(500).json({
            error: 'Failed to calculate route',
            details: error.message
        });
    }
};

const getDistanceMatrix = async (req, res) => {
    try {
        const { coordinates } = req.body;

        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return res.status(400).json({
                error: 'Invalid coordinates',
                message: 'Request body must contain an array of at least 2 coordinate pairs [lon, lat]'
            });
        }

        const formattedCoords = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
        const url = `${process.env.OSRM_BASE_URL || 'http://localhost:5000'}/table/v1/driving/${formattedCoords}`;

        const response = await require('axios').get(url, { timeout: 5000 });

        if (response.data.code !== 'Ok') {
            throw new Error(`OSRM table returned error code: ${response.data.code}`);
        }

        return res.status(200).json({
            success: true,
            data: response.data.durations,
        });
    } catch (error) {
        console.error('Distance matrix controller error:', error.message);
        return res.status(500).json({
            error: 'Failed to calculate distance matrix',
            details: error.message
        });
    }
};

module.exports = {
    getRoute,
    getDistanceMatrix,
};
