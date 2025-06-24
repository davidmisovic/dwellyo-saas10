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
  process.env.SUPABASE_URL || 'your-supabase-url',
  process.env.SUPABASE_ANON_KEY || 'your-supabase-key'
);

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

// User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, fullName, password } = req.body;

    // Validate input
    if (!email || !fullName || !password) {
      return res.status(400).render('register', { 
        error: 'All fields are required' 
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).render('register', { 
        error: 'User with this email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const { data, error } = await supabase
      .from('users')
      .insert([{ 
        email, 
        full_name: fullName,
        password_hash: hashedPassword,
        subscription_tier: 'trial'
      }])
      .select()
      .single();

    if (error) throw error;

    // Set session
    req.session.user = {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      subscription_tier: data.subscription_tier
    };

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).render('register', { 
      error: 'Registration failed. Please try again.' 
    });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).render('login', { 
        error: 'Email and password are required' 
      });
    }

    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(400).render('login', { 
        error: 'Invalid email or password' 
      });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
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

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
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

// Update Property API
app.put('/api/properties/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, address, rent_price, deposit, description, bedrooms, bathrooms, status } = req.body;

    const { data, error } = await supabase
      .from('properties')
      .update({
        title,
        address,
        rent_price: parseFloat(rent_price),
        deposit: deposit ? parseFloat(deposit) : null,
        description,
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        bathrooms: bathrooms ? parseInt(bathrooms) : null,
        status,
        updated_at: new Date()
      })
      .eq('id', id)
      .eq('user_id', req.session.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update property error:', error);
    res.status(500).json({ error: 'Failed to update property' });
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

// Add Lead API (for contact forms from property listings)
app.post('/api/leads', async (req, res) => {
  try {
    const { property_id, name, email, phone, message } = req.body;

    if (!property_id || !name || !email) {
      return res.status(400).json({ 
        error: 'Property ID, name, and email are required' 
      });
    }

    const { data, error } = await supabase
      .from('leads')
      .insert([{
        property_id,
        name,
        email,
        phone,
        message,
        status: 'new'
      }])
      .select()
      .single();

    if (error) throw error;

    // Here you could trigger AI response or email notification
    console.log('New lead created:', data);

    res.json(data);
  } catch (error) {
    console.error('Add lead error:', error);
    res.status(500).json({ error: 'Failed to add lead' });
  }
});

// Get Leads API
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    // Get user's properties first
    const { data: properties } = await supabase
      .from('properties')
      .select('id')
      .eq('user_id', req.session.user.id);

    const propertyIds = properties?.map(p => p.id) || [];

    // Get leads for user's properties
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
      .in('property_id', propertyIds)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(leads || []);
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Update Lead Status API
app.put('/api/leads/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('leads')
      .update({ 
        status,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Update lead status error:', error);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// AI Chat Simulation API (placeholder for future AI integration)
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { lead_id, message } = req.body;

    // Store the conversation
    const { data, error } = await supabase
      .from('conversations')
      .insert([{
        lead_id,
        message,
        sender: 'human'
      }])
      .select()
      .single();

    if (error) throw error;

    // Simulate AI response (replace with actual AI integration later)
    const aiResponse = generateSimpleAIResponse(message);

    // Store AI response
    const { data: aiData } = await supabase
      .from('conversations')
      .insert([{
        lead_id,
        message: aiResponse,
        sender: 'ai'
      }])
      .select()
      .single();

    res.json({
      human_message: data,
      ai_response: aiData
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

// Simple AI response generator (placeholder)
function generateSimpleAIResponse(message) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('viewing') || lowerMessage.includes('visit')) {
    return "I'd be happy to schedule a viewing for you! What days work best for you this week?";
  } else if (lowerMessage.includes('price') || lowerMessage.includes('rent')) {
    return "The rental price includes utilities and is negotiable for long-term tenants. Would you like to discuss the details?";
  } else if (lowerMessage.includes('available') || lowerMessage.includes('when')) {
    return "The property is available for immediate move-in. When would you ideally like to start your tenancy?";
  } else if (lowerMessage.includes('pet') || lowerMessage.includes('dog') || lowerMessage.includes('cat')) {
    return "We do consider pets on a case-by-case basis. Could you tell me more about your pet?";
  } else {
    return "Thank you for your message! I'll make sure the landlord gets back to you within 24 hours with detailed information.";
  }
}

// =================
// ERROR HANDLING
// =================

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
  console.log(`🌐 URL: https://dwellyo-saas.${process.env.REPL_OWNER}.repl.co`);
  console.log('🚀 Ready to revolutionize rental management!');
});