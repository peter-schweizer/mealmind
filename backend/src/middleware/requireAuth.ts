import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { query, queryOne } from '../db';

// Augment Express's Request so req.userId is available everywhere without casting
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Keep this alias for backwards compat (routes that import it can stay as-is)
export type AuthRequest = Request;

/**
 * Middleware: enforce authentication via Clerk.
 * Extracts userId from the Clerk session, auto-creates a user_profile
 * on first sign-in, and attaches userId to req.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  (req as AuthRequest).userId = userId;

  // Auto-provision a profile row for first-time users
  const existing = await queryOne(
    'SELECT id FROM user_profile WHERE clerk_user_id = $1',
    [userId],
  );

  if (!existing) {
    await query(
      `INSERT INTO user_profile
         (clerk_user_id, name, dietary_preferences, dislikes, allergies,
          household_size, pantry_staples, owned_ingredients)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId,
        'Mein Profil',
        '[]', '[]', '[]', 2,
        JSON.stringify(['Salz', 'Pfeffer', 'Mehl', 'Öl', 'Zucker',
          'Butter', 'Knoblauch', 'Zwiebeln', 'Essig']),
        '[]',
      ],
    );
  }

  next();
}
