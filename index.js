const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://rxtepmxuaabisibnntdd.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4dGVwbXh1YWFiaXNpYm5udGRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3NzY4MTEsImV4cCI6MjA2NjM1MjgxMX0.NGdSjDsGNT0Vx0mNVK2vhfg7g0WZiC6Sd1MeocrHanY'
);

// Test Supabase connection on startup
(async () => {
  try {
    console.log('🔍 Testing Supabase connection...');
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set ✓' : 'Missing ✗');
    console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'Set ✓' : 'Missing ✗');

    const { data, error } = await supabase.from('users').select('count');
    if (error) {
      console.log('❌ Database connection failed:', error.message);
    } else {
      console.log('✅ Database connection successful');
    }
  } catch (err) {
    console.log('❌ Supabase setup error:', err.message);
  }
})();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dwellyo-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Serve static files
app.use(express.static('public'));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// =================
// MAIN ROUTES
// =================

// Landing page
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Dwellyo.ai - Your AI Rental Assistant',
    user: req.session.user || null
  });
});

// Authentication pages
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('register', { error: null });
});

// Dashboard (protected)
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    // Get user's properties count
    const { data: properties, error: propError } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', req.session.user.id);

    // Get user's leads count
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('*')
      .in('property_id', properties?.map(p => p.id) || []);

    // Calculate stats
    const stats = {
      totalProperties: properties?.length || 0,
      activeLeads: leads?.filter(l => l.status === 'new' || l.status === 'contacted').length || 0,
      totalLeads: leads?.length || 0,
      occupiedProperties: properties?.filter(p => p.status === 'rented').length || 0
    };

    res.render('dashboard', { 
      user: req.session.user,
      stats,
      recentProperties: properties?.slice(0, 5) || [],
      recentLeads: leads?.slice(0, 5) || []
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard', { 
      user: req.session.user,
      stats: { totalProperties: 0, activeLeads: 0, totalLeads: 0, occupiedProperties: 0 },
      recentProperties: [],
      recentLeads: []
    });
  }
});

// Properties page
app.get('/properties', requireAuth, async (req, res) => {
  try {
    const { data: properties, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', req.session.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('properties', { 
      user: req.session.user,
      properties: properties || []
    });
  } catch (error) {
    console.error('Properties error:', error);
    res.render('properties', { 
      user: req.session.user,
      properties: []
    });
  }
});

// Leads page
app.get('/leads', requireAuth, async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select(`
        *,
        properties (
          title,
          address,
          rent_price
        )
      `)
      .order('created_at', { ascending: false });

    // Filter leads for user's properties only
    const userProperties = await supabase
      .from('properties')
      .select('id')
      .eq('user_id', req.session.user.id);

    const userPropertyIds = userProperties.data?.map(p => p.id) || [];
    const userLeads = leads?.filter(lead => userPropertyIds.includes(lead.property_id)) || [];

    res.render('leads', { 
      user: req.session.user,
      leads: userLeads
    });
  } catch (error) {
    console.error('Leads error:', error);
    res.render('leads', { 
      user: req.session.user,
      leads: []
    });
  }
});

// Pricing page
app.get('/pricing', (req, res) => {
  res.render('pricing', { 
    user: req.session.user || null
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// =================
// API ROUTES
// =================

// User Registration - IMPROVED WITH BETTER ERROR HANDLING
app.post('/api/register', async (req, res) => {
  try {
    console.log('🔑 Registration attempt started...');
    console.log('📝 Request body:', { email: req.body.email, fullName: req.body.fullName, hasPassword: !!req.body.password });

    const { email, fullName, password } = req.body;

    // Validate input
    if (!email || !fullName || !password) {
      console.log('❌ Validation failed: missing fields');
      return res.status(400).render('register', { 
        error: 'All fields are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Validation failed: invalid email format');
      return res.status(400).render('register', { 
        error: 'Please enter a valid email address' 
      });
    }

    // Validate password length
    if (password.length < 6) {
      console.log('❌ Validation failed: password too short');
      return res.status(400).render('register', { 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Test database connection first
    console.log('🔍 Testing database connection...');
    const { error: connectionError } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (connectionError) {
      console.log('❌ Database connection failed:', connectionError);
      return res.status(500).render('register', { 
        error: 'Database connection failed. Please check your Supabase settings and try again.' 
      });
    }
    console.log('✅ Database connection successful');

    // Check if user already exists
    console.log('👤 Checking if user exists...');
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (checkError) {
      console.log('❌ Error checking existing user:', checkError);
      return res.status(500).render('register', { 
        error: `Database error: ${checkError.message}` 
      });
    }

    if (existingUser) {
      console.log('❌ User already exists');
      return res.status(400).render('register', { 
        error: 'An account with this email already exists. Please try logging in instead.' 
      });
    }
    console.log('✅ Email is available');

    // Hash password
    console.log('🔐 Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('✅ Password hashed successfully');

    // Create user
    console.log('👤 Creating user account...');
    const { data, error } = await supabase
      .from('users')
      .insert([{ 
        email: email.toLowerCase(),
        full_name: fullName,
        password_hash: hashedPassword,
        subscription_tier: 'trial'
      }])
      .select()
      .single();

    if (error) {
      console.log('❌ User creation failed:', error);
      return res.status(500).render('register', { 
        error: `Account creation failed: ${error.message}. Please try again.` 
      });
    }

    if (!data) {
      console.log('❌ No user data returned');
      return res.status(500).render('register', { 
        error: 'Account creation failed. Please try again.' 
      });
    }

    console.log('✅ User created successfully:', { id: data.id, email: data.email });

    // Set session
    req.session.user = {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      subscription_tier: data.subscription_tier
    };

    console.log('✅ Session created, redirecting to dashboard...');
    res.redirect('/dashboard');

  } catch (error) {
    console.error('💥 Registration error:', error);
    res.status(500).render('register', { 
      error: `Registration failed: ${error.message}. Please try again or contact support.` 
    });
  }
});

// User Login - IMPROVED
app.post('/api/login', async (req, res) => {
  try {
    console.log('🔑 Login attempt started...');
    const { email, password } = req.body;

    if (!email || !password) {
      console.log('❌ Login validation failed: missing credentials');
      return res.status(400).render('login', { 
        error: 'Email and password are required' 
      });
    }

    // Find user
    console.log('👤 Looking for user...');
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      console.log('❌ User not found:', error?.message);
      return res.status(400).render('login', { 
        error: 'Invalid email or password' 
      });
    }

    // Check password
    console.log('🔐 Verifying password...');
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('❌ Invalid password');
      return res.status(400).render('login', { 
        error: 'Invalid email or password' 
      });
    }

    // Set session
    req.session.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      subscription_tier: user.subscription_tier
    };

    console.log('✅ Login successful, redirecting to dashboard...');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('💥 Login error:', error);
    res.status(500).render('login', { 
      error: 'Login failed. Please try again.' 
    });
  }
});

// Get Properties API
app.get('/api/properties', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', req.session.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// Add Property API
app.post('/api/properties', requireAuth, async (req, res) => {
  try {
    const { title, address, rent_price, deposit, description, bedrooms, bathrooms } = req.body;

    // Validate required fields
    if (!title || !address || !rent_price) {
      return res.status(400).json({ 
        error: 'Title, address, and rent price are required' 
      });
    }

    const { data, error } = await supabase
      .from('properties')
      .insert([{
        user_id: req.session.user.id,
        title,
        address,
        rent_price: parseFloat(rent_price),
        deposit: deposit ? parseFloat(deposit) : null,
        description,
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        bathrooms: bathrooms ? parseInt(bathrooms) : null,
        status: 'available'
      }])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Add property error:', error);
    res.status(500).json({ error: 'Failed to add property' });
  }
});

// Delete Property API
app.delete('/api/properties/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', id)
      .eq('user_id', req.session.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete property error:', error);
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { 
    user: req.session.user || null 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Something went wrong!');
});

// =================
// START SERVER
// =================

app.listen(PORT, () => {
  console.log(`🏠 Dwellyo server running on port ${PORT}`);
  console.log(`🚀 Ready to revolutionize rental management!`);
});