const express = require('express');
const cors = require('cors');
const sql = require('mssql/msnodesqlv8');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'segurospro_secret_2024';
const JWT_EXPIRES = '8h';

// Multer para fotos de perfil (solo imágenes, 5 MB)
const uploadFoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        allowed.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
    }
});

// Multer para multimedia de siniestros (imágenes, video, PDF, 20 MB)
const uploadMultimedia = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp',
            'video/mp4', 'video/quicktime',
            'application/pdf'
        ];
        allowed.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error('Formato no permitido. Use JPG, PNG, MP4, MOV o PDF.'));
    }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => res.redirect('/login.html'));

const sqlConfig = {
    connectionString: 'Driver={SQL Server};Server=MI_LAPTOP\\MSSQLSERVER01;Database=db_SegurosPro;Trusted_Connection=yes;'
};

let pool;

async function initDB() {
    try {
        pool = await new sql.ConnectionPool(sqlConfig).connect();
        console.log('✅ Conectado a db_SegurosPro');
    } catch (err) {
        console.error('❌ Error de conexión a SQL Server:', err.message);
        process.exit(1);
    }
}

// ─── MIDDLEWARE: VERIFICAR TOKEN ──────────────────────────────────────────────
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Acceso no autorizado. Token requerido.' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ success: false, message: 'Token inválido o expirado.' });
        req.usuario = decoded;
        next();
    });
}

// ─── MIDDLEWARE: REQUERIR ROL ─────────────────────────────────────────────────
function requerirRol(...roles) {
    return (req, res, next) => {
        if (!req.usuario || !roles.includes(req.usuario.tipoUsuario)) {
            return res.status(403).json({ success: false, message: 'No tienes permisos para esta acción.' });
        }
        next();
    };
}

const ESTADOS_VALIDOS = [
    'Pendiente',
    'Rechazado',
    'Aceptado',
    'Aceptado con pago de deducible',
    'Aceptado sin pago de deducible',
    'Aplica pago para reparación',
    'Pérdida total'
];

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dbConnected: !!pool });
});

// ─── REGISTRO ────────────────────────────────────────────────────────────────
app.post('/api/register', uploadFoto.single('foto'), async (req, res) => {
    try {
        const {
            nombre, apellido, fecha_nacimiento,
            genero, email, telefono, alias, rol, password
        } = req.body;

        if (!nombre || !apellido || !email || !alias || !password) {
            return res.status(400).json({ success: false, message: 'Todos los campos obligatorios deben completarse.' });
        }

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

        const fechaStr = fecha_nacimiento || null;
        const fotoBuffer = req.file ? req.file.buffer : null;
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.request()
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Apellidos', sql.NVarChar(100), apellido)
            .input('FechaNacimiento', sql.NVarChar(10), fechaStr)
            .input('Foto', sql.VarBinary(sql.MAX), fotoBuffer)
            .input('Genero', sql.NVarChar(1), generoMapeado)
            .input('Correo', sql.NVarChar(150), email)
            .input('Telefono', sql.VarChar(15), telefono || null)
            .input('Contrasena', sql.NVarChar(256), hashedPassword)
            .input('Alias', sql.NVarChar(50), alias)
            .input('TipoUsuario', sql.NVarChar(20), rolMapeado)
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
        res.status(500).json({ success: false, message: 'Error interno del servidor.', detail: err.message });
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

// ─── PERFIL ───────────────────────────────────────────────────────────────────
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

// ─── USUARIOS: BUSCAR ASEGURADOS (para vincular en registro) ──────────────────
app.get('/api/usuarios/asegurados', verificarToken, requerirRol('Ajustador', 'Supervisor'), async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json({ success: true, usuarios: [] });
        }
        const result = await pool.request()
            .input('Busqueda', sql.NVarChar(200), `%${q.trim()}%`)
            .query(`
                SELECT UsuarioID, Nombre, Apellidos, Correo
                FROM dbo.Usuario
                WHERE TipoUsuario = 'Asegurado'
                  AND (Nombre + ' ' + Apellidos LIKE @Busqueda OR Correo LIKE @Busqueda)
            `);
        res.json({ success: true, usuarios: result.recordset });
    } catch (err) {
        console.error('❌ Error en GET /api/usuarios/asegurados:', err);
        res.status(500).json({ success: false, message: 'Error al buscar asegurados.' });
    }
});

// ─── SINIESTROS: BUSCAR (debe ir ANTES de /:id) ───────────────────────────────
app.get('/api/siniestros/buscar', verificarToken, async (req, res) => {
    try {
        const { tipoUsuario, id: usuarioID, nombre } = req.usuario;
        const { desde, hasta, aseguradora, estado, placa } = req.query;

        const request = pool.request();
        const where = [];

        if (tipoUsuario === 'Ajustador') {
            where.push('s.AjustadorID = @UsuarioID');
            request.input('UsuarioID', sql.Int, usuarioID);
        } else if (tipoUsuario === 'Asegurado') {
            // Acceso por AseguradoID explícito O por coincidencia de NombreCliente
            const userInfo = await pool.request().input('UID', sql.Int, usuarioID)
                .query(`SELECT Nombre + ' ' + Apellidos AS NombreCompleto FROM dbo.Usuario WHERE UsuarioID = @UID`);
            const nombreCompleto = userInfo.recordset[0]?.NombreCompleto || '';
            where.push('(s.AseguradoID = @UsuarioID OR s.NombreCliente = @NombreCompleto)');
            request.input('UsuarioID', sql.Int, usuarioID);
            request.input('NombreCompleto', sql.NVarChar(200), nombreCompleto);
        }

        if (desde) {
            where.push('s.FechaIncidente >= @Desde');
            request.input('Desde', sql.NVarChar(10), desde);
        }
        if (hasta) {
            where.push('s.FechaIncidente <= @Hasta');
            request.input('Hasta', sql.NVarChar(10), hasta);
        }
        if (aseguradora) {
            where.push('s.NombreAseguradora LIKE @Aseguradora');
            request.input('Aseguradora', sql.NVarChar(200), `%${aseguradora}%`);
        }
        if (estado) {
            where.push('s.Estado = @Estado');
            request.input('Estado', sql.NVarChar(60), estado);
        }
        if (placa) {
            where.push('(s.PlacasUnidad LIKE @Placa OR s.SerieUnidad LIKE @Placa)');
            request.input('Placa', sql.NVarChar(50), `%${placa}%`);
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        const result = await request.query(`
            SELECT s.SiniestroID,
                   'SIN-' + RIGHT('0000' + CAST(s.SiniestroID AS VARCHAR), 4) AS Folio,
                   s.NombreAseguradora, s.NumeroPoliza, s.NombreCliente,
                   s.MarcaUnidad, s.ModeloUnidad, s.PlacasUnidad, s.SerieUnidad,
                   s.FechaIncidente, s.Estado, s.FechaRegistro,
                   u.Nombre + ' ' + u.Apellidos AS NombreAjustador
            FROM dbo.Siniestro s
            JOIN dbo.Usuario u ON u.UsuarioID = s.AjustadorID
            ${whereClause}
            ORDER BY s.FechaRegistro DESC
        `);

        res.json({ success: true, siniestros: result.recordset });
    } catch (err) {
        console.error('❌ Error en GET /api/siniestros/buscar:', err);
        res.status(500).json({ success: false, message: 'Error en la búsqueda.' });
    }
});

// ─── SINIESTROS: CREAR ────────────────────────────────────────────────────────
app.post('/api/siniestros', verificarToken, requerirRol('Ajustador'), uploadMultimedia.array('archivos', 20), async (req, res) => {
    try {
        const {
            nombreAseguradora, noPoliza, nombreCliente,
            marcaUnidad, modeloUnidad, placasUnidad, serieUnidad,
            fechaIncidente, horaIncidente, lugarIncidente,
            involucrados, descripcion, aseguradoId
        } = req.body;

        if (!nombreAseguradora || !noPoliza || !nombreCliente || !marcaUnidad ||
            !modeloUnidad || !placasUnidad || !serieUnidad ||
            !fechaIncidente || !horaIncidente || !lugarIncidente || !descripcion) {
            return res.status(400).json({ success: false, message: 'Todos los campos obligatorios son requeridos.' });
        }

        const aseguradoIdParsed = aseguradoId ? parseInt(aseguradoId) : null;

        const result = await pool.request()
            .input('AjustadorID', sql.Int, req.usuario.id)
            .input('AseguradoID', sql.Int, aseguradoIdParsed)
            .input('NombreAseguradora', sql.NVarChar(200), nombreAseguradora)
            .input('NumeroPoliza', sql.NVarChar(100), noPoliza)
            .input('NombreCliente', sql.NVarChar(200), nombreCliente)
            .input('MarcaUnidad', sql.NVarChar(100), marcaUnidad)
            .input('ModeloUnidad', sql.NVarChar(100), modeloUnidad)
            .input('PlacasUnidad', sql.NVarChar(20), placasUnidad)
            .input('SerieUnidad', sql.NVarChar(50), serieUnidad)
            .input('FechaIncidente', sql.NVarChar(10), fechaIncidente)
            .input('HoraIncidente', sql.NVarChar(8), horaIncidente)
            .input('LugarIncidente', sql.NVarChar(500), lugarIncidente)
            .input('Involucrados', sql.NVarChar(sql.MAX), involucrados || null)
            .input('Descripcion', sql.NVarChar(sql.MAX), descripcion)
            .query(`
                INSERT INTO dbo.Siniestro
                    (AjustadorID, AseguradoID, NombreAseguradora, NumeroPoliza, NombreCliente,
                     MarcaUnidad, ModeloUnidad, PlacasUnidad, SerieUnidad,
                     FechaIncidente, HoraIncidente, LugarIncidente, Involucrados, Descripcion)
                OUTPUT INSERTED.SiniestroID
                VALUES
                    (@AjustadorID, @AseguradoID, @NombreAseguradora, @NumeroPoliza, @NombreCliente,
                     @MarcaUnidad, @ModeloUnidad, @PlacasUnidad, @SerieUnidad,
                     @FechaIncidente, @HoraIncidente, @LugarIncidente, @Involucrados, @Descripcion)
            `);

        const siniestroID = result.recordset[0].SiniestroID;

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await pool.request()
                    .input('SiniestroID', sql.Int, siniestroID)
                    .input('NombreArchivo', sql.NVarChar(255), file.originalname)
                    .input('TipoMime', sql.NVarChar(100), file.mimetype)
                    .input('TamanoBytes', sql.Int, file.size)
                    .input('Datos', sql.VarBinary(sql.MAX), file.buffer)
                    .input('SubidoPorID', sql.Int, req.usuario.id)
                    .query(`
                        INSERT INTO dbo.Multimedia_Siniestro
                            (SiniestroID, NombreArchivo, TipoMime, TamanoBytes, Datos, SubidoPorID)
                        VALUES (@SiniestroID, @NombreArchivo, @TipoMime, @TamanoBytes, @Datos, @SubidoPorID)
                    `);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Siniestro registrado exitosamente.',
            siniestroID,
            folio: `SIN-${String(siniestroID).padStart(4, '0')}`
        });

    } catch (err) {
        console.error('❌ Error en POST /api/siniestros:', err);
        res.status(500).json({ success: false, message: 'Error al registrar el siniestro.', detail: err.message });
    }
});

// ─── SINIESTROS: LISTAR ───────────────────────────────────────────────────────
app.get('/api/siniestros', verificarToken, async (req, res) => {
    try {
        const { tipoUsuario, id: usuarioID } = req.usuario;
        const request = pool.request().input('UsuarioID', sql.Int, usuarioID);

        let whereClause = '';
        if (tipoUsuario === 'Ajustador') {
            whereClause = 'WHERE s.AjustadorID = @UsuarioID';
        } else if (tipoUsuario === 'Asegurado') {
            // Acceso por AseguradoID explícito O por coincidencia de NombreCliente
            const userInfo = await pool.request().input('UID', sql.Int, usuarioID)
                .query(`SELECT Nombre + ' ' + Apellidos AS NombreCompleto FROM dbo.Usuario WHERE UsuarioID = @UID`);
            const nombreCompleto = userInfo.recordset[0]?.NombreCompleto || '';
            request.input('NombreCompleto', sql.NVarChar(200), nombreCompleto);
            whereClause = 'WHERE (s.AseguradoID = @UsuarioID OR s.NombreCliente = @NombreCompleto)';
        }

        const result = await request.query(`
            SELECT s.SiniestroID,
                   'SIN-' + RIGHT('0000' + CAST(s.SiniestroID AS VARCHAR), 4) AS Folio,
                   s.NombreAseguradora, s.NumeroPoliza, s.NombreCliente,
                   s.MarcaUnidad, s.ModeloUnidad, s.PlacasUnidad, s.SerieUnidad,
                   s.FechaIncidente, s.HoraIncidente, s.LugarIncidente,
                   s.Descripcion, s.Estado, s.FechaRegistro,
                   u.Nombre + ' ' + u.Apellidos AS NombreAjustador
            FROM dbo.Siniestro s
            JOIN dbo.Usuario u ON u.UsuarioID = s.AjustadorID
            ${whereClause}
            ORDER BY s.FechaRegistro DESC
        `);

        res.json({ success: true, siniestros: result.recordset });
    } catch (err) {
        console.error('❌ Error en GET /api/siniestros:', err);
        res.status(500).json({ success: false, message: 'Error al obtener siniestros.' });
    }
});

// ─── SINIESTROS: CAMBIAR ESTADO (solo Supervisor) ─────────────────────────────
app.patch('/api/siniestros/:id/estado', verificarToken, requerirRol('Supervisor'), async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);
        const { estado } = req.body;

        if (!ESTADOS_VALIDOS.includes(estado)) {
            return res.status(400).json({ success: false, message: 'Estado no válido.', estadosValidos: ESTADOS_VALIDOS });
        }

        const result = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .input('Estado', sql.NVarChar(60), estado)
            .query(`
                UPDATE dbo.Siniestro
                SET Estado = @Estado, FechaActualizacion = GETDATE()
                WHERE SiniestroID = @SiniestroID
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ success: false, message: 'Siniestro no encontrado.' });
        }

        res.json({ success: true, message: 'Estado actualizado correctamente.' });
    } catch (err) {
        console.error('❌ Error en PATCH /api/siniestros/:id/estado:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar el estado.' });
    }
});

// ─── MULTIMEDIA: SUBIR ARCHIVOS ────────────────────────────────────────────────
app.post('/api/siniestros/:id/multimedia', verificarToken, requerirRol('Ajustador', 'Supervisor'), uploadMultimedia.array('archivos', 20), async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);

        const check = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query('SELECT AjustadorID FROM dbo.Siniestro WHERE SiniestroID = @SiniestroID');

        if (check.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Siniestro no encontrado.' });
        }

        if (req.usuario.tipoUsuario === 'Ajustador' && check.recordset[0].AjustadorID !== req.usuario.id) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No se enviaron archivos.' });
        }

        for (const file of req.files) {
            await pool.request()
                .input('SiniestroID', sql.Int, siniestroID)
                .input('NombreArchivo', sql.NVarChar(255), file.originalname)
                .input('TipoMime', sql.NVarChar(100), file.mimetype)
                .input('TamanoBytes', sql.Int, file.size)
                .input('Datos', sql.VarBinary(sql.MAX), file.buffer)
                .input('SubidoPorID', sql.Int, req.usuario.id)
                .query(`
                    INSERT INTO dbo.Multimedia_Siniestro
                        (SiniestroID, NombreArchivo, TipoMime, TamanoBytes, Datos, SubidoPorID)
                    VALUES (@SiniestroID, @NombreArchivo, @TipoMime, @TamanoBytes, @Datos, @SubidoPorID)
                `);
        }

        res.json({ success: true, message: `${req.files.length} archivo(s) guardado(s) correctamente.` });
    } catch (err) {
        console.error('❌ Error en POST /api/siniestros/:id/multimedia:', err);
        res.status(500).json({ success: false, message: 'Error al guardar los archivos.' });
    }
});

// ─── MULTIMEDIA: LISTAR POR SINIESTRO ─────────────────────────────────────────
app.get('/api/siniestros/:id/multimedia', verificarToken, async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);
        const result = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query(`
                SELECT m.MultimediaID, m.NombreArchivo, m.TipoMime, m.TamanoBytes, m.FechaSubida,
                       u.Nombre + ' ' + u.Apellidos AS SubidoPor
                FROM dbo.Multimedia_Siniestro m
                JOIN dbo.Usuario u ON u.UsuarioID = m.SubidoPorID
                WHERE m.SiniestroID = @SiniestroID
                ORDER BY m.FechaSubida DESC
            `);

        res.json({ success: true, archivos: result.recordset });
    } catch (err) {
        console.error('❌ Error en GET /api/siniestros/:id/multimedia:', err);
        res.status(500).json({ success: false, message: 'Error al obtener multimedia.' });
    }
});

// ─── MULTIMEDIA: SERVIR BINARIO ────────────────────────────────────────────────
app.get('/api/multimedia/:id', verificarToken, async (req, res) => {
    try {
        const multimediaID = parseInt(req.params.id);
        const result = await pool.request()
            .input('MultimediaID', sql.Int, multimediaID)
            .query('SELECT NombreArchivo, TipoMime, Datos FROM dbo.Multimedia_Siniestro WHERE MultimediaID = @MultimediaID');

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Archivo no encontrado.' });
        }

        const { NombreArchivo, TipoMime, Datos } = result.recordset[0];
        res.setHeader('Content-Type', TipoMime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(NombreArchivo)}"`);
        res.send(Datos);
    } catch (err) {
        console.error('❌ Error en GET /api/multimedia/:id:', err);
        res.status(500).json({ success: false, message: 'Error al servir el archivo.' });
    }
});

// ─── SINIESTROS: DETALLE ──────────────────────────────────────────────────────
app.get('/api/siniestros/:id', verificarToken, async (req, res) => {
    try {
        const { tipoUsuario, id: usuarioID } = req.usuario;
        const siniestroID = parseInt(req.params.id);

        const result = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query(`
                SELECT s.*,
                       'SIN-' + RIGHT('0000' + CAST(s.SiniestroID AS VARCHAR), 4) AS Folio,
                       u.Nombre + ' ' + u.Apellidos AS NombreAjustador,
                       CONVERT(VARCHAR(10), s.FechaCompromiso, 23) AS FechaCompromisoStr
                FROM dbo.Siniestro s
                JOIN dbo.Usuario u ON u.UsuarioID = s.AjustadorID
                WHERE s.SiniestroID = @SiniestroID
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Siniestro no encontrado.' });
        }

        const siniestro = result.recordset[0];

        if (tipoUsuario === 'Ajustador' && siniestro.AjustadorID !== usuarioID) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
        }
        if (tipoUsuario === 'Asegurado') {
            // Acceso por AseguradoID explícito O por coincidencia de NombreCliente
            const userInfo = await pool.request().input('UID', sql.Int, usuarioID)
                .query(`SELECT Nombre + ' ' + Apellidos AS NombreCompleto FROM dbo.Usuario WHERE UsuarioID = @UID`);
            const nombreCompleto = userInfo.recordset[0]?.NombreCompleto || '';
            if (siniestro.AseguradoID !== usuarioID && siniestro.NombreCliente !== nombreCompleto) {
                return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
            }
        }

        res.json({ success: true, siniestro });
    } catch (err) {
        console.error('❌ Error en GET /api/siniestros/:id:', err);
        res.status(500).json({ success: false, message: 'Error al obtener el siniestro.' });
    }
});

// ─── SINIESTROS: FECHA COMPROMISO ─────────────────────────────────────────────
app.patch('/api/siniestros/:id/compromiso', verificarToken, requerirRol('Supervisor', 'Ajustador'), async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);
        const { fechaCompromiso } = req.body;
        const { tipoUsuario, id: usuarioID } = req.usuario;

        if (!fechaCompromiso || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCompromiso)) {
            return res.status(400).json({ success: false, message: 'Fecha inválida. Use formato YYYY-MM-DD.' });
        }

        const check = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query('SELECT AjustadorID FROM dbo.Siniestro WHERE SiniestroID = @SiniestroID');

        if (check.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Siniestro no encontrado.' });
        }

        if (tipoUsuario === 'Ajustador' && check.recordset[0].AjustadorID !== usuarioID) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
        }

        await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .input('FechaCompromiso', sql.Date, fechaCompromiso)
            .query(`
                UPDATE dbo.Siniestro
                SET FechaCompromiso = @FechaCompromiso, FechaActualizacion = GETDATE()
                WHERE SiniestroID = @SiniestroID
            `);

        res.json({ success: true, message: 'Fecha de compromiso actualizada.' });
    } catch (err) {
        console.error('❌ Error en PATCH /api/siniestros/:id/compromiso:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar la fecha de compromiso.' });
    }
});

// ─── COMENTARIOS: AGREGAR ─────────────────────────────────────────────────────
app.post('/api/siniestros/:id/comentarios', verificarToken, async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);
        const { mensaje } = req.body;
        const { tipoUsuario, id: usuarioID } = req.usuario;

        if (!mensaje || !mensaje.trim()) {
            return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
        }

        const check = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query('SELECT AjustadorID, AseguradoID, NombreCliente FROM dbo.Siniestro WHERE SiniestroID = @SiniestroID');

        if (check.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Siniestro no encontrado.' });
        }

        const s = check.recordset[0];
        if (tipoUsuario === 'Ajustador' && s.AjustadorID !== usuarioID) {
            return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
        }
        if (tipoUsuario === 'Asegurado') {
            // Acceso por AseguradoID explícito O por coincidencia de NombreCliente
            const userInfo = await pool.request().input('UID', sql.Int, usuarioID)
                .query(`SELECT Nombre + ' ' + Apellidos AS NombreCompleto FROM dbo.Usuario WHERE UsuarioID = @UID`);
            const nombreCompleto = userInfo.recordset[0]?.NombreCompleto || '';
            if (s.AseguradoID !== usuarioID && s.NombreCliente !== nombreCompleto) {
                return res.status(403).json({ success: false, message: 'No tienes acceso a este siniestro.' });
            }
        }

        await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .input('AutorID', sql.Int, usuarioID)
            .input('Mensaje', sql.NVarChar(sql.MAX), mensaje.trim())
            .query(`
                INSERT INTO dbo.Comentario (SiniestroID, AutorID, Mensaje)
                VALUES (@SiniestroID, @AutorID, @Mensaje)
            `);

        res.status(201).json({ success: true, message: 'Comentario agregado.' });
    } catch (err) {
        console.error('❌ Error en POST /api/siniestros/:id/comentarios:', err);
        res.status(500).json({ success: false, message: 'Error al agregar el comentario.' });
    }
});

// ─── COMENTARIOS: LISTAR ──────────────────────────────────────────────────────
app.get('/api/siniestros/:id/comentarios', verificarToken, async (req, res) => {
    try {
        const siniestroID = parseInt(req.params.id);
        const result = await pool.request()
            .input('SiniestroID', sql.Int, siniestroID)
            .query(`
                SELECT c.ComentarioID, c.Mensaje, c.FechaCreacion,
                       u.UsuarioID, u.Nombre + ' ' + u.Apellidos AS Autor,
                       u.TipoUsuario AS RolAutor
                FROM dbo.Comentario c
                JOIN dbo.Usuario u ON u.UsuarioID = c.AutorID
                WHERE c.SiniestroID = @SiniestroID
                ORDER BY c.FechaCreacion ASC
            `);

        res.json({ success: true, comentarios: result.recordset });
    } catch (err) {
        console.error('❌ Error en GET /api/siniestros/:id/comentarios:', err);
        res.status(500).json({ success: false, message: 'Error al obtener comentarios.' });
    }
});

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor en http://localhost:${PORT}`);
    });
});
