const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // npm install jsonwebtoken
const path = require('path');

const app = express();
const PORT = 3000;

// ─── SECRETO JWT (en producción usa una variable de entorno) ──────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'segurospro_secret_2024';
const JWT_EXPIRES = '8h'; // Token válido por 8 horas

// ─── MULTER — solo imágenes, máx 5MB ─────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        allowed.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
    }
});

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => res.redirect('/login.html'));

// ─── CONEXIÓN SQL SERVER ──────────────────────────────────────────────────────
const sqlConfig = {
    connectionString: 'Driver={SQL Server};Server=MI_LAPTOP\\MSSQLSERVER01;Database=db_SegurosPro;Trusted_Connection=yes;'
};

let pool; // Pool global

async function initDB() {
    try {
        pool = await new sql.ConnectionPool(sqlConfig).connect();
        console.log('✅ Conectado a db_SegurosPro');
    } catch (err) {
        console.error('❌ Error de conexión a SQL Server:', err.message);
        process.exit(1); // Detener el servidor si no hay DB
    }
}

// ─── MIDDLEWARE JWT — protege rutas privadas ──────────────────────────────────
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

    if (!token) return res.status(401).json({ success: false, message: 'Acceso no autorizado. Token requerido.' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: 'Token inválido o expirado.' });
        req.usuario = decoded; // { id, nombre, tipoUsuario }
        next();
    });
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dbConnected: !!pool });
});

// ─── REGISTRO ─────────────────────────────────────────────────────────────────
app.post('/api/register', upload.single('foto'), async (req, res) => {
    try {
        const {
            nombre, apellido, fecha_nacimiento,
            genero, email, telefono, alias, rol, password
        } = req.body;

        // Validaciones básicas
        if (!nombre || !apellido || !email || !alias || !password) {
            return res.status(400).json({ success: false, message: 'Todos los campos obligatorios deben completarse.' });
        }

        // Mapeos
        const rolMapeado = rol
            ? rol.charAt(0).toUpperCase() + rol.slice(1).toLowerCase()
            : 'Asegurado';

        const rolesValidos = ['Asegurado', 'Ajustador', 'Supervisor'];
        if (!rolesValidos.includes(rolMapeado)) {
            return res.status(400).json({ success: false, message: 'Rol de usuario no válido.' });
        }

        const generoMapeado = genero === 'masculino' ? 'M'
            : genero === 'femenino' ? 'F'
                : null;

        const fotoBuffer = req.file ? req.file.buffer : null;

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.request()
            .input('Nombre', sql.VarChar(100), nombre)
            .input('Apellidos', sql.VarChar(100), apellido)
            .input('FechaNacimiento', sql.Date, fecha_nacimiento)
            .input('Foto', sql.VarBinary(sql.MAX), fotoBuffer)
            .input('Genero', sql.Char(1), generoMapeado)
            .input('Correo', sql.VarChar(150), email)
            .input('Telefono', sql.VarChar(15), telefono || '')
            .input('Contrasena', sql.VarChar(256), hashedPassword)
            .input('Alias', sql.VarChar(50), alias)
            .input('TipoUsuario', sql.VarChar(20), rolMapeado)
            // IMPORTANTE: el nombre del campo en la query usa N'' para soportar ñ y tildes
            .query(`
                INSERT INTO dbo.Usuario 
                    (Nombre, Apellidos, FechaNacimiento, Foto, Genero, Correo, Telefono, [Contraseña], Alias, TipoUsuario)
                VALUES 
                    (@Nombre, @Apellidos, @FechaNacimiento, @Foto, @Genero, @Correo, @Telefono, @Contrasena, @Alias, @TipoUsuario)
            `);

        res.status(201).json({ success: true, message: 'Usuario registrado exitosamente.' });

    } catch (err) {
        console.error('❌ Error en /api/register:', err);

        if (err.number === 2627 || err.number === 2601) {
            return res.status(409).json({ success: false, message: 'El correo o alias ya está registrado.' });
        }
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;

        if (!usuario || !password) {
            return res.status(400).json({ success: false, message: 'Usuario y contraseña son requeridos.' });
        }

        const result = await pool.request()
            .input('Login', sql.VarChar(150), usuario)
            .query(`
                SELECT UsuarioID, [Contraseña], TipoUsuario, Nombre, Apellidos
                FROM dbo.Usuario
                WHERE Correo = @Login OR Alias = @Login
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
        }

        const user = result.recordset[0];
        const match = await bcrypt.compare(password, user['Contraseña']);

        if (!match) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
        }

        // Generar JWT
        const token = jwt.sign(
            { id: user.UsuarioID, nombre: user.Nombre, tipoUsuario: user.TipoUsuario },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );

        res.json({
            success: true,
            message: `Bienvenido, ${user.Nombre} ${user.Apellidos}`,
            token,
            tipoUsuario: user.TipoUsuario,
            nombreCompleto: `${user.Nombre} ${user.Apellidos}`,
            usuarioID: user.UsuarioID
        });

    } catch (err) {
        console.error('❌ Error en /api/login:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
});

// ─── EJEMPLO DE RUTA PROTEGIDA ────────────────────────────────────────────────
// Úsala como modelo para tus demás endpoints privados
app.get('/api/perfil', verificarToken, async (req, res) => {
    try {
        const result = await pool.request()
            .input('ID', sql.Int, req.usuario.id)
            .query(`
                SELECT UsuarioID, Nombre, Apellidos, Correo, Alias, TipoUsuario, Genero, Telefono
                FROM dbo.Usuario
                WHERE UsuarioID = @ID
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        }

        res.json({ success: true, perfil: result.recordset[0] });
    } catch (err) {
        console.error('❌ Error en /api/perfil:', err);
        res.status(500).json({ success: false, message: 'Error al obtener perfil.' });
    }
});

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor en http://localhost:${PORT}`);
    });
});