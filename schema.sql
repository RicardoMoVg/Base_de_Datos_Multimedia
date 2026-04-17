-- ============================================================
-- Script de creación de tablas para db_SegurosPro
-- Ejecutar contra: db_SegurosPro
-- ============================================================

-- Eliminar tablas si ya existen (en orden por FK)
IF OBJECT_ID('dbo.Comentario', 'U') IS NOT NULL DROP TABLE dbo.Comentario;
IF OBJECT_ID('dbo.Multimedia_Siniestro', 'U') IS NOT NULL DROP TABLE dbo.Multimedia_Siniestro;
IF OBJECT_ID('dbo.Siniestro', 'U') IS NOT NULL DROP TABLE dbo.Siniestro;

-- ── TABLA: Siniestro ────────────────────────────────────────
-- Estados válidos: Pendiente | Rechazado | Aceptado |
-- Aceptado con pago de deducible | Aceptado sin pago de deducible |
-- Aplica pago para reparación | Pérdida total
CREATE TABLE dbo.Siniestro (
    SiniestroID         INT             IDENTITY(1,1)  PRIMARY KEY,
    AjustadorID         INT             NOT NULL        REFERENCES dbo.Usuario(UsuarioID),
    AseguradoID         INT             NULL            REFERENCES dbo.Usuario(UsuarioID),
    NombreAseguradora   NVARCHAR(200)   NOT NULL,
    NumeroPoliza        NVARCHAR(100)   NOT NULL,
    NombreCliente       NVARCHAR(200)   NOT NULL,
    MarcaUnidad         NVARCHAR(100)   NOT NULL,
    ModeloUnidad        NVARCHAR(100)   NOT NULL,
    PlacasUnidad        NVARCHAR(20)    NOT NULL,
    SerieUnidad         NVARCHAR(50)    NOT NULL,
    FechaIncidente      DATE            NOT NULL,
    HoraIncidente       NVARCHAR(8)     NOT NULL,
    LugarIncidente      NVARCHAR(500)   NOT NULL,
    Involucrados        NVARCHAR(MAX)   NULL,
    Descripcion         NVARCHAR(MAX)   NOT NULL,
    Estado              NVARCHAR(60)    NOT NULL        DEFAULT 'Pendiente',
    FechaRegistro       DATETIME        NOT NULL        DEFAULT GETDATE(),
    FechaActualizacion  DATETIME        NULL
);

-- ── TABLA: Multimedia_Siniestro ─────────────────────────────
-- Almacena binarios de fotos, videos y PDFs del expediente
CREATE TABLE dbo.Multimedia_Siniestro (
    MultimediaID    INT             IDENTITY(1,1)  PRIMARY KEY,
    SiniestroID     INT             NOT NULL        REFERENCES dbo.Siniestro(SiniestroID),
    NombreArchivo   NVARCHAR(255)   NOT NULL,
    TipoMime        NVARCHAR(100)   NOT NULL,
    TamanoBytes     INT             NOT NULL,
    Datos           VARBINARY(MAX)  NOT NULL,
    FechaSubida     DATETIME        NOT NULL        DEFAULT GETDATE(),
    SubidoPorID     INT             NOT NULL        REFERENCES dbo.Usuario(UsuarioID)
);

-- ── TABLA: Comentario ───────────────────────────────────────
-- Línea de tiempo de mensajes por siniestro (asegurado / ajustador / supervisor)
CREATE TABLE dbo.Comentario (
    ComentarioID    INT             IDENTITY(1,1)  PRIMARY KEY,
    SiniestroID     INT             NOT NULL        REFERENCES dbo.Siniestro(SiniestroID),
    AutorID         INT             NOT NULL        REFERENCES dbo.Usuario(UsuarioID),
    Mensaje         NVARCHAR(MAX)   NOT NULL,
    FechaCreacion   DATETIME        NOT NULL        DEFAULT GETDATE()
);
