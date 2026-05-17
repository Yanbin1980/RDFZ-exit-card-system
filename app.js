const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ students: [], settings: { defaultValidUntil: '' } }, null, 2));
} else {
    const data = readData();
    if (!data.settings) {
        data.settings = { defaultValidUntil: '' };
        writeData(data);
    }
}

function readData() {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeData(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
    }
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'exit-card-secret', resave: false, saveUninitialized: true }));

const ADMIN_PASSWORD = 'admin123';

app.get('/', (req, res) => res.render('student'));

app.post('/submit', upload.single('photo'), async (req, res) => {
    const { name, grade, classNum, teacher, mon, tue, wed, thu, fri } = req.body;
    if (!name || !grade || !classNum || !teacher || !mon || !tue || !wed || !thu || !fri) {
        return res.send('请填写所有字段');
    }
    let photoPath = null;
    if (req.file) photoPath = '/uploads/' + req.file.filename;
    const className = grade + classNum;
    const data = readData();
    const defaultValidUntil = data.settings?.defaultValidUntil || '';
    const newRecord = {
        id: Date.now(),
        name,
        className,
        teacher,
        mon, tue, wed, thu, fri,
        validUntil: defaultValidUntil,
        photo: photoPath,
        createdAt: new Date().toISOString()
    };
    data.students.push(newRecord);
    writeData(data);
    res.send('<h3>提交成功！<a href="/">返回</a></h3>');
});

app.get('/admin/login', (req, res) => res.render('login'));
app.post('/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.admin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.send('密码错误');
    }
});

function requireAdmin(req, res, next) {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
}

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    const data = readData();
    const students = [...data.students].reverse();
    res.render('dashboard', { students });
});

app.get('/admin/card/:id', requireAdmin, (req, res) => {
    const data = readData();
    const student = data.students.find(s => s.id == req.params.id);
    if (!student) return res.status(404).send('记录不存在');
    res.render('card', { student });
});

app.get('/admin/batch-print', requireAdmin, (req, res) => {
    const ids = req.query.ids?.split(',').map(id => parseInt(id));
    if (!ids) return res.redirect('/admin/dashboard');
    const data = readData();
    const selectedStudents = data.students.filter(s => ids.includes(s.id));
    res.render('cards_batch', { students: selectedStudents });
});

app.get('/admin/export', requireAdmin, (req, res) => {
    const data = readData();
    const students = data.students;
    const header = ['姓名', '班级', '班主任', '周一', '周二', '周三', '周四', '周五', '有效期至', '提交时间'];
    const rows = students.map(s => [s.name, s.className, s.teacher, s.mon, s.tue, s.wed, s.thu, s.fri, s.validUntil, s.createdAt]);
    const csvContent = [header, ...rows].map(row => row.join(',')).join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename=students.csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + csvContent);
});

app.post('/admin/update-valid', requireAdmin, (req, res) => {
    const { id, validUntil } = req.body;
    if (!id || !validUntil) return res.status(400).json({ error: '缺少参数' });
    const data = readData();
    const student = data.students.find(s => s.id == parseInt(id));
    if (student) {
        student.validUntil = validUntil;
        writeData(data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: '记录不存在' });
    }
});

app.post('/admin/delete', requireAdmin, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: '缺少ID' });
    const data = readData();
    data.students = data.students.filter(s => s.id != id);
    writeData(data);
    res.json({ success: true });
});

app.post('/admin/batch-delete', requireAdmin, (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请选择记录' });
    const data = readData();
    const beforeCount = data.students.length;
    data.students = data.students.filter(s => !ids.includes(s.id));
    writeData(data);
    res.json({ success: true, deletedCount: beforeCount - data.students.length });
});

app.get('/admin/settings', requireAdmin, (req, res) => {
    const data = readData();
    const defaultValidUntil = data.settings?.defaultValidUntil || '';
    const msg = req.query.msg || '';
    res.render('admin_settings', { defaultValidUntil, msg });
});

app.post('/admin/settings', requireAdmin, (req, res) => {
    const { defaultValidUntil } = req.body;
    const data = readData();
    if (!data.settings) data.settings = {};
    data.settings.defaultValidUntil = defaultValidUntil || '';
    writeData(data);
    res.redirect('/admin/settings?msg=保存成功');
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.listen(PORT, () => {
    console.log(`✅ 服务器运行成功！请打开浏览器访问 http://localhost:${PORT}`);
});