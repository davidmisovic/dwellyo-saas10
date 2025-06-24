<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Dwellyo</title>
    <link href="/css/style.css" rel="stylesheet">
</head>
<body>
    <nav class="navbar">
        <div class="nav-container">
            <h1 class="logo">Dwellyo.ai</h1>
            <div class="nav-links">
                <span>Welcome, <%= user.full_name %></span>
                <a href="/logout">Logout</a>
            </div>
        </div>
    </nav>

    <div class="dashboard">
        <aside class="sidebar">
            <ul>
                <li><a href="#properties">Properties</a></li>
                <li><a href="#leads">Leads</a></li>
                <li><a href="#conversations">AI Conversations</a></li>
                <li><a href="#settings">Settings</a></li>
            </ul>
        </aside>

        <main class="main-content">
            <h1>Dashboard</h1>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Properties</h3>
                    <p class="stat-number">0</p>
                </div>
                <div class="stat-card">
                    <h3>Active Leads</h3>
                    <p class="stat-number">0</p>
                </div>
                <div class="stat-card">
                    <h3>This Month</h3>
                    <p class="stat-number">€0</p>
                </div>
            </div>

            <div class="quick-actions">
                <button class="btn-primary" onclick="addProperty()">Add Property</button>
                <button class="btn-secondary">View Analytics</button>
            </div>
        </main>
    </div>

    <script src="/js/dashboard.js"></script>
</body>
</html>