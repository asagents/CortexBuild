import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseClient } from '@supabase/supabase-js';

const JWT_SECRET = process.env.JWT_SECRET || 'cortexbuild-secret-2025';
const TOKEN_EXPIRY = '24h';

interface JWTPayload {
  userId: string;
  email: string;
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar: string;
  company_id?: string;
  password_hash?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
}

let supabaseInstance: SupabaseClient | null = null;

export const setDatabase = (supa: SupabaseClient) => {
  supabaseInstance = supa;
};

const requireSupa = (): SupabaseClient => {
  if (!supabaseInstance) {
    throw new Error('Supabase client not initialized');
  }
  return supabaseInstance;
};

const mapUserRow = (row: Record<string, any> | null): UserProfile | null => {
  if (!row) return null;
  const firstName = row.first_name ?? '';
  const lastName = row.last_name ?? '';
  const legacyName = row.name ?? '';
  const displayName = `${firstName} ${lastName}`.trim() || legacyName.trim() || row.email || 'User';
  return {
    id: String(row.id),
    email: row.email,
    name: displayName,
    role: row.role,
    avatar: row.avatar_url ?? row.avatar ?? '',
    company_id:
      row.company_id !== undefined && row.company_id !== null
        ? String(row.company_id)
        : undefined,
    password_hash: row.password_hash,
    password: row.password,
    first_name: row.first_name,
    last_name: row.last_name,
  };
};

const createDevelopmentUser = async (supa: SupabaseClient, email: string, password: string): Promise<UserProfile | null> => {
  console.log('👤 [Auth] Creating development user:', email);
  const passwordHash = bcrypt.hashSync(password, 10);
  const companyName = email === 'admin@cortexbuild.com' ? 'CortexBuild' : 'ConstructCo';

  let { data: company } = await supa.from('companies').select('id').ilike('name', companyName).single();
  let companyId: string;
  if (!company) {
    const { data: inserted, error } = await supa.from('companies').insert({ name: companyName }).select('id').single();
    if (error) throw error;
    companyId = inserted.id;
  } else {
    companyId = company.id;
  }

  const role = email === 'admin@cortexbuild.com' ? 'super_admin' : 'company_admin';
  const name = email === 'admin@cortexbuild.com' ? 'System Administrator' : 'Project Manager';
  const [firstName, ...rest] = name.split(' ');
  const lastName = rest.join(' ') || firstName;

  const { data: user, error: userError } = await supa
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      first_name: firstName,
      last_name: lastName,
      role,
      company_id: companyId,
      is_active: true,
      email_verified: true,
    })
    .select()
    .single();

  if (userError) throw userError;
  return mapUserRow(user);
};

const getUserByEmail = async (supa: SupabaseClient, email: string): Promise<UserProfile | null> => {
  const { data, error } = await supa.from('users').select('*').ilike('email', email).single();
  if (error) return null;
  return mapUserRow(data);
};

const getUserById = async (supa: SupabaseClient, id: string | number): Promise<UserProfile | null> => {
  const { data, error } = await supa.from('users').select('*').eq('id', id).single();
  if (error) return null;
  return mapUserRow(data);
};

export const login = async (
  supa: SupabaseClient,
  email: string,
  password: string,
) => {
  console.log('🔐 [Auth] Login attempt:', email);
  const user = await getUserByEmail(supa, email);

  if (!user && (email === 'admin@cortexbuild.com' || email === 'manager@constructco.com')) {
    console.log('👤 [Auth] Creating development user');
    const devUser = await createDevelopmentUser(supa, email, password);
    if (devUser) {
      const token = jwt.sign({ userId: devUser.id, email: devUser.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
      return { token, user: devUser };
    }
  }

  if (!user) {
    console.error('❌ [Auth] User not found');
    throw new Error('Invalid email or password');
  }

  const hash = user.password_hash ?? user.password;
  const isValidPassword = hash ? bcrypt.compareSync(password, hash) : false;

  if (!isValidPassword) {
    console.error('❌ [Auth] Invalid password');
    throw new Error('Invalid email or password');
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  console.log('✅ [Auth] Login successful');
  return { token, user };
};

export const register = async (
  supa: SupabaseClient,
  email: string,
  password: string,
  name: string,
  _companyName: string,
) => {
  console.log('📝 [Auth] Registration attempt:', email);

  const existingUser = await getUserByEmail(supa, email);
  if (existingUser) {
    console.error('❌ [Auth] User already exists');
    throw new Error('User already exists');
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const trimmedName = name.trim();
  const [firstName, ...rest] = trimmedName.split(' ');
  const lastName = rest.join(' ') || firstName;

  const { data: user, error: userError } = await supa
    .from('users')
    .insert({
      email,
      password: passwordHash,
      first_name: firstName,
      last_name: lastName,
      role: 'user',
      is_active: true,
      email_verified: true,
    })
    .select()
    .single();

  if (userError) throw userError;

  const token = jwt.sign({ userId: String(user.id), email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  console.log('✅ [Auth] User registered successfully');
  return { token, user: mapUserRow(user)! };
};

export const verifyToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const getCurrentUserByToken = async (supa: SupabaseClient, token: string) => {
  const payload = verifyToken(token);
  const user = await getUserById(supa, payload.userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

export const logout = async (_supa: SupabaseClient, _token: string) => {
  console.log('👋 [Auth] Logout');
  return { success: true };
};

export const refreshToken = async (token: string) => {
  console.log('🔄 [Auth] Refreshing token');
  const supa = requireSupa();
  const payload = verifyToken(token);
  const user = await getUserById(supa, payload.userId);
  if (!user) {
    throw new Error('User not found');
  }
  const newToken = jwt.sign({ userId: String(user.id), email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  console.log('✅ [Auth] Token refreshed');
  return { token: newToken, user };
};

export const cleanupExpiredSessions = () => {
  // Supabase handles session expiry via auth; this is a no-op
  console.log('🧹 [Auth] Cleanup not needed with Supabase');
};

export const getCurrentUser = async (req: any, res: any, next: any) => {
  const authHeader = req.headers?.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  try {
    const supa = requireSupa();
    const payload = verifyToken(token);
    const user = await getUserById(supa, payload.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    const { data: company } = await supa.from('companies').select('name').eq('id', user.company_id || '').single();
    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name ?? user.email,
      role: user.role,
      companyId: user.company_id,
      companyName: company?.name ?? 'Unknown Company',
    };
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ success: false, error: 'Invalid token' });
  }
};

export const authenticateToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers?.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  try {
    const supa = requireSupa();
    const payload = verifyToken(token);
    const user = await getUserById(supa, payload.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ success: false, error: 'Invalid token' });
  }
};

export default {
  login,
  register,
  verifyToken,
  getCurrentUser,
  getCurrentUserByToken,
  logout,
  refreshToken,
  authenticateToken,
  cleanupExpiredSessions,
  setDatabase,
};
