const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const { GoogleGenerativeAI } = require('@google/generative-ai');

const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' })); // Increased limit for base64 images
app.use(express.static(path.join(__dirname)));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(uploadsDir));

const usersFile = path.join(__dirname, 'users.json');

// Initialize users file if not exists
if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify([]));
}

function getUsers() {
    try {
        const data = fs.readFileSync(usersFile);
        return JSON.parse(data);
    } catch(e) { return []; }
}

const itemsFile = path.join(__dirname, 'items.json');
if (!fs.existsSync(itemsFile)) {
    fs.writeFileSync(itemsFile, JSON.stringify({ apps: [], tools: [], mods: [] }));
}

function getItems() {
    try {
        const data = fs.readFileSync(itemsFile);
        let parsed = JSON.parse(data);
        if(!parsed.mods) parsed.mods = [];
        return parsed;
    } catch(e) { return { apps: [], tools: [], mods: [] }; }
}

function saveItems(items) {
    fs.writeFileSync(itemsFile, JSON.stringify(items, null, 2));
}

function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

const settingsFile = path.join(__dirname, 'settings.json');
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({ geminiApiKey: "" }));
}
function getSettings() {
    try { return JSON.parse(fs.readFileSync(settingsFile)); } catch(e) { return { geminiApiKey: "" }; }
}
function saveSettings(s) {
    fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
}

const statsFile = path.join(__dirname, 'stats.json');
if (!fs.existsSync(statsFile)) {
    fs.writeFileSync(statsFile, JSON.stringify({ downloads: 1542 }));
}
function getStats() {
    try { return JSON.parse(fs.readFileSync(statsFile)); } catch(e) { return { downloads: 1542 }; }
}
function saveStats(s) {
    fs.writeFileSync(statsFile, JSON.stringify(s, null, 2));
}

// Generate simple tokens
function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// API Routes
app.get('/api/stats', (req, res) => {
    const items = getItems();
    const stats = getStats();
    res.json({
        itemsCount: items.apps.length + items.tools.length + items.mods.length,
        usersCount: getUsers().length,
        downloads: stats.downloads
    });
});

app.post('/api/track-action', (req, res) => {
    const { action, detail, token } = req.body;
    let users = getUsers();
    let u = users.find(x => x.token === token);
    let username = u ? u.name : 'سەردانکەرێک';
    
    if (action === 'download') {
        const s = getStats();
        s.downloads++;
        saveStats(s);
        io.emit('liveAction', { action: 'بەرنامەیەکی دابەزاند', detail: detail, username: username, avatar: u ? u.avatar : `https://i.pravatar.cc/150?u=${Math.random()}` });
    }
    res.json({ success: true });
});

app.post('/api/signup', (req, res) => {
    const { name, email, password } = req.body;
    let users = getUsers();
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'ئەم ئیمەیڵە پێشتر تۆمارکراوە' });
    }
    
    // Automatically assign the very first user as "owner"
    const isFirstUser = users.length === 0;
    const role = isFirstUser ? 'owner' : 'member';
    
    const token = generateToken();
    const newUser = {
        id: Date.now(),
        name,
        email,
        password,
        role,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
        token
    };
    users.push(newUser);
    saveUsers(users);
    res.json({ success: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, avatar: newUser.avatar, role: newUser.role, token: newUser.token } });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const users = getUsers();
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) {
        return res.status(401).json({ error: 'ئیمەیڵ یان پاسۆرد هەڵەیە' });
    }
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, role: user.role || 'member', token: user.token } });
});

app.post('/api/update-profile', (req, res) => {
    const { token, name, email, currentPassword, newPassword, avatar } = req.body;
    let users = getUsers();
    const index = users.findIndex(u => u.token === token);
    if (index === -1) {
        return res.status(401).json({ error: 'گونجاو نییە، تکایە سەرلەنوێ لۆگین بکەوە' });
    }
    
    // Check password if they want to change it
    if (newPassword) {
        if (users[index].password !== currentPassword) {
            return res.status(400).json({ error: 'پاسۆردە کۆنەکەت هەڵەیە' });
        }
        users[index].password = newPassword;
    }
    
    if (name) users[index].name = name;
    if (email) users[index].email = email;
    if (avatar) users[index].avatar = avatar;

    saveUsers(users);
    
    const user = users[index];
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, role: user.role || 'owner', token: user.token } });
});

// Admin endpoints
app.get('/api/users', (req, res) => {
    const token = req.query.token;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ error: 'بەداخەوە مافت نییە' });
    }
    const safeUsers = users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar }));
    res.json(safeUsers);
});

app.post('/api/update-role', (req, res) => {
    const { token, targetUserId, newRole } = req.body;
    let users = getUsers();
    const requester = users.find(u => u.token === token);
    
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ error: 'مافی گۆڕینی ڕۆڵت نییە' });
    }
    
    const targetIndex = users.findIndex(u => u.id === targetUserId);
    if (targetIndex === -1) return res.status(404).json({ error: 'یوزەر نەدۆزرایەوە' });
    
    if (requester.role === 'admin' && (users[targetIndex].role === 'owner' || newRole === 'owner')) {
        return res.status(403).json({ error: 'ئەدمین ناتوانێت دەسکاری ڕۆڵی خاوەن بکات' });
    }
    
    users[targetIndex].role = newRole;
    saveUsers(users);
    res.json({ success: true });
});

app.get('/api/items', (req, res) => {
    res.json(getItems());
});

app.post('/api/add-item', upload.fields([{ name: 'itemFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]), (req, res) => {
    const { token, type, title, category, imageUrl, rating, downloadUrl } = req.body;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ error: 'مافی زیادکردنت نییە' });
    }
    
    let finalDownloadUrl = downloadUrl || '#';
    if (req.files && req.files['itemFile'] && req.files['itemFile'][0]) {
        finalDownloadUrl = '/uploads/' + req.files['itemFile'][0].filename;
    }

    let finalImageUrl = imageUrl || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop';
    if (req.files && req.files['imageFile'] && req.files['imageFile'][0]) {
        finalImageUrl = '/uploads/' + req.files['imageFile'][0].filename;
    }
    
    let items = getItems();
    const newItem = {
        id: Date.now(),
        title,
        category,
        downloadUrl: finalDownloadUrl,
        imageUrl: finalImageUrl,
        rating: rating || "4.8"
    };
    
    if (type === 'app') {
        items.apps.push(newItem);
    } else if (type === 'tool') {
        items.tools.push(newItem);
    } else {
        items.mods.push(newItem);
    }
    
    saveItems(items);
    res.json({ success: true, item: newItem });
});

app.post('/api/delete-item', (req, res) => {
    const { token, type, id } = req.body;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ error: 'مافت نییە بۆ سڕینەوە' });
    }
    
    let items = getItems();
    if (type === 'app') {
        items.apps = items.apps.filter(i => i.id !== parseInt(id));
    } else if (type === 'tool') {
        items.tools = items.tools.filter(i => i.id !== parseInt(id));
    } else {
        items.mods = items.mods.filter(i => i.id !== parseInt(id));
    }
    
    saveItems(items);
    res.json({ success: true });
});

app.post('/api/edit-item', upload.fields([{ name: 'itemFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]), (req, res) => {
    const { token, type, id, title, category, imageUrl, rating, downloadUrl } = req.body;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ error: 'مافت نییە بۆ دەستکاریکردن' });
    }
    
    let items = getItems();
    
    // Natively locate the original item disregarding dropdown submission
    let oldType = null;
    let idx = -1;
    if (items.apps.findIndex(i => i.id === parseInt(id)) !== -1) {
        oldType = 'app';
        idx = items.apps.findIndex(i => i.id === parseInt(id));
    } else if (items.tools.findIndex(i => i.id === parseInt(id)) !== -1) {
        oldType = 'tool';
        idx = items.tools.findIndex(i => i.id === parseInt(id));
    } else if (items.mods.findIndex(i => i.id === parseInt(id)) !== -1) {
        oldType = 'mod';
        idx = items.mods.findIndex(i => i.id === parseInt(id));
    }

    if (idx === -1) return res.status(404).json({ error: 'نەدۆزرایەوە' });
    
    let sourceArr = oldType === 'app' ? items.apps : (oldType === 'tool' ? items.tools : items.mods);
    let itemToUpdate = sourceArr[idx];
    
    let finalDownloadUrl = downloadUrl;
    if (req.files && req.files['itemFile'] && req.files['itemFile'][0]) {
        finalDownloadUrl = '/uploads/' + req.files['itemFile'][0].filename;
    }

    let finalImageUrl = imageUrl;
    if (req.files && req.files['imageFile'] && req.files['imageFile'][0]) {
        finalImageUrl = '/uploads/' + req.files['imageFile'][0].filename;
    }
    
    if (title) itemToUpdate.title = title;
    if (category) itemToUpdate.category = category;
    if (finalImageUrl) itemToUpdate.imageUrl = finalImageUrl;
    if (rating) itemToUpdate.rating = rating;
    if (finalDownloadUrl) itemToUpdate.downloadUrl = finalDownloadUrl;
    
    // Cross-Category migration dynamically
    if (type && type !== oldType) {
        sourceArr.splice(idx, 1);
        if (type === 'app') items.apps.push(itemToUpdate);
        else if (type === 'tool') items.tools.push(itemToUpdate);
        else if (type === 'mod') items.mods.push(itemToUpdate);
    }
    
    saveItems(items);
    res.json({ success: true, item: itemToUpdate });
});

app.get('/api/settings', (req, res) => {
    const { token } = req.query;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    if (!requester || requester.role !== 'owner') return res.status(403).json({ error: 'تەنها خاوەن دەتوانیت ئەمە بکات' });
    res.json(getSettings());
});

app.post('/api/settings', (req, res) => {
    const { token, geminiApiKey } = req.body;
    const users = getUsers();
    const requester = users.find(u => u.token === token);
    if (!requester || requester.role !== 'owner') return res.status(403).json({ error: 'مافت نییە' });
    const s = getSettings();
    s.geminiApiKey = geminiApiKey || "";
    saveSettings(s);
    res.json({ success: true });
});

// AI Chatbot endpoint
app.post('/api/ai-chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.json({ reply: 'تکایە پرسیارەکەت بنووسە.' });
    
    const text = message;
    const s = getSettings();
    
    if (!s.geminiApiKey) {
        return res.json({ reply: 'ببورە، ژیری دەستکرد هێشتا بە تەواوی دانەمەزراوە. پێویستە خاوەنی سایتەکە کلیلی (API Key) ی گووگڵ جێمینای لە بەشی ڕێکخستنەکانی ئەدمین دابنێت تاوەکو من ڕووحم بێتەوە بەر و بتوانم کار بکەم!' });
    }
    
    try {
        const genAI = new GoogleGenerativeAI(s.geminiApiKey);
        const items = getItems();
        const availableItems = [...items.apps, ...items.tools]
            .map(i => `- ناو: ${i.title} (کەتەگۆری: ${i.category}, ئەستێرە: ${i.rating})، لینکی داگرتن: ${i.downloadUrl}`)
            .join('\n');
            
        const systemPrompt = `تۆ ناوت "نێکسس ئەی ئای" (NEXUS AI)یە، یاریدەدەرێکی تایبەتی سەنتەری نێکسس بۆ ئەپڵیکەیشن و تووڵەکان. 
تکایە هەمیشە بە زمانی کوردی (سۆرانی) بە ڕێزەوە وەڵام بدەرەوە و هاوکاری بەکارهێنەر بکە.
داتابەیسی سەنتەرەکەمان لەم کاتەدا ئەم بەرنامە و تووڵانەی تێدایە (لینکەکانیان هەیە بەڵام خۆت وێنەی دروستکە بۆیان ئەگەر پێویست بکات):
${availableItems || 'هیچ بەرنامەیەک لەناو داتابەیس نییە'}

ڕێنماییەکانت:
- وەڵامێکی کورت و پوخت و جوان بەکاربهێنە.
- هەموو کات لینکەکانی داگرتن لە شێوەی ئەی تاگی html دا بدە بە بەکارهێنەر <a href="بەسەر">ناوی بەرنامە</a> تا بتوانێت کلیکی لێ بکات.
- هێماکانی ماڕکداون وەک دوو ئەستێرە بۆ بۆڵد **کەلیمە** مەکارمەهێنە، بەڵکو لەبری ئەوە <strong>کەلیمە</strong> بەکاربهێنە، پەرەگرافەکان بە <br> جیابکەوە.
- هەر پرسیارێکیان لێکردیت باسی سەنتەرەکە یان هەر پڕۆگرامێک یان شتێکی گشتی ئایتی، بە جوانی یارمەتییان بدە وەک باشترین مۆدێلی ژیری دەستکرد لە جیهان و خۆت پێشکەش بکە بە (NEXUS AI).`;
           
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(systemPrompt + '\n\nبەکارهێنەر: ' + text);
        const response = await result.response;
        
        let replyHtml = response.text().replace(/\n/g, '<br>');
        res.json({ reply: replyHtml });
    } catch (error) {
        console.error(error);
        res.json({ reply: 'ببورە، کێشەیەک ڕوویدا لە پەیوەندی کردن بە دەماغی سەرەکی گووگڵ جێمینای. لەوانەیە کلیلەکە (API Key) هەڵە بێت یان هێڵەکە کێشەی هەبێت.' });
    }
});

let onlineUsers = 0;

io.on('connection', (socket) => {
    onlineUsers++;
    io.emit('userCount', onlineUsers);

    // Listen for incoming chat messages
    socket.on('chatMessage', (msg) => {
        // Send message to everyone EXCEPT the sender
        socket.broadcast.emit('chatMessage', msg);
    });

    socket.on('deleteMessage', (data) => {
        let users = getUsers();
        let u = users.find(x => x.token === data.token);
        if (u && (u.role === 'owner' || u.role === 'admin')) {
            io.emit('messageDeleted', data.msgId);
        }
    });

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('userCount', onlineUsers);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
