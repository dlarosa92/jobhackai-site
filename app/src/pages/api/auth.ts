import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    // For local development, return a mock response
    // In production, this would verify the token with Firebase Admin SDK
    const mockUser = {
      success: true,
      user: {
        uid: 'mock_user_' + Date.now(),
        email: 'test@example.com',
        emailVerified: true,
        displayName: 'Test User'
      },
      message: 'Authentication successful (mock)'
    };

    return res.status(200).json(mockUser);
  } catch (error: any) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message
    });
  }
}
