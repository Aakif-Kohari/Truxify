const refreshTokenService = require('../services/refreshTokenService');

const refreshToken = async (req, res) => {
    try {
        const { refreshToken, deviceId, deviceInfo } = req.body;

        if (!refreshToken || !deviceId) {
            return res.status(400).json({ error: 'Refresh token and deviceId are required' });
        }

        const newTokenData = await refreshTokenService.rotateRefreshToken(refreshToken, deviceId, deviceInfo);
        const newAccessToken = 'new-jwt-access-token-placeholder';

        return res.status(200).json({
            success: true,
            accessToken: newAccessToken,
            refreshToken: newTokenData.token,
            expiresAt: newTokenData.expires_at,
        });
    } catch (err) {
        if (err.message.includes('Token reuse detected')) {
            return res.status(401).json({ error: 'Security Alert: Token theft detected. All sessions terminated.' });
        }
        return res.status(401).json({ error: err.message });
    }
};

const logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (refreshToken) {
            await refreshTokenService.revokeToken(refreshToken);
        }
        return res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const logoutAllDevices = async (req, res) => {
    try {
        const userId = req.user.uid;
        await refreshTokenService.revokeAllUserTokens(userId);
        return res.status(200).json({ success: true, message: 'Logged out from all devices' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    refreshToken,
    logout,
    logoutAllDevices,
};
