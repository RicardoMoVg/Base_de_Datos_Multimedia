const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'views');
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.html'));

// ── Determine role by filename ────────────────────────────────────────────────
function getRoleForFile(file) {
    const supervisorFiles = [
        'dash_supervisor.html', 'vista_supervisor.html', 'historial_global.html', 'busqueda_avanzada.html', 'gestion_reparaciones.html'
    ];
    const aseguradoFiles = [
        'dash_asegurado.html', 'seguimiento_siniestro.html', 'historial_pagos.html'
    ];
    const loginFiles = [
        'login.html', 'registro.html', 'error.html'
    ];
    if (loginFiles.includes(file)) return 'login';
    if (supervisorFiles.includes(file)) return 'Supervisor';
    if (aseguradoFiles.includes(file)) return 'Asegurado';
    return 'Ajustador';
}

// ── Per-role nav links ────────────────────────────────────────────────────────
function getNavLinks(role, currentFile) {
    const active = (href) =>
        currentFile === href ? ' class="active"' : '';

    if (role === 'Ajustador') {
        return `
                <a${active('dash_ajustador.html')} href="dash_ajustador.html">Inicio</a>
                <a${active('registro_siniestro.html')} href="registro_siniestro.html">Registrar Siniestro</a>
                <a${active('consulta_siniestros.html')} href="consulta_siniestros.html">Mis Registros</a>
                <a${active('buscar_siniestros.html')} href="buscar_siniestros.html">Buscador</a>
                <a${active('detalle_siniestro.html')} href="detalle_siniestro.html">Mensajes / Dudas</a>`;
    }
    if (role === 'Supervisor') {
        return `
                <a${active('dash_supervisor.html')} href="dash_supervisor.html">Panel de Control</a>
                <a${active('vista_supervisor.html')} href="vista_supervisor.html">Autorizaciones</a>
                <a${active('historial_global.html')} href="historial_global.html">Historial Global</a>
                <a${active('busqueda_avanzada.html')} href="busqueda_avanzada.html">Búsqueda Avanzada</a>
                <a${active('gestion_reparaciones.html')} href="gestion_reparaciones.html">Gestión Reparaciones</a>`;
    }
    if (role === 'Asegurado') {
        return `
                <a${active('dash_asegurado.html')} href="dash_asegurado.html">Mi Unidad</a>
                <a${active('seguimiento_siniestro.html')} href="seguimiento_siniestro.html">Seguimiento</a>
                <a${active('consulta_siniestros.html')} href="consulta_siniestros.html">Historial de Pagos</a>
                <a href="detalle_siniestro.html">Soporte / Contacto</a>`;
    }
    return '';
}

// ── Per-role user info ────────────────────────────────────────────────────────
function getUserInfo(role) {
    if (role === 'Supervisor') return { name: 'Laura S.', sub: 'Autorización Múltiple', init: 'LS' };
    if (role === 'Asegurado') return { name: 'Roberto D.', sub: 'Póliza Activa', init: 'RD' };
    return { name: 'Carlos A.', sub: 'Región Norte', init: 'CA' };
}

// ── Build topbar HTML ─────────────────────────────────────────────────────────
function buildTopbar(role, file) {
    if (role === 'login') {
        return `    <header class="topbar">
        <div class="topbar-left">
            <a href="login.html" class="topbar-logo">
                <h1>Seguros<span>Pro</span></h1>
            </a>
        </div>
    </header>`;
    }

    const dashHref =
        role === 'Supervisor' ? 'dash_supervisor.html' :
            role === 'Asegurado' ? 'dash_asegurado.html' :
                'dash_ajustador.html';

    const { name, sub, init } = getUserInfo(role);
    const navLinks = getNavLinks(role, file);

    return `    <header class="topbar">
        <div class="topbar-left">
            <a href="${dashHref}" class="topbar-logo">
                <h1>Seguros<span>Pro</span></h1>
            </a>
            <nav class="topbar-nav">${navLinks}
            </nav>
        </div>
        <div class="topbar-right">
            <span class="badge-role">${role}</span>
            <div class="user-badge">
                <div class="user-info">
                    <strong>${name}</strong>
                    <small>${sub}</small>
                </div>
                <div class="avatar">${init}</div>
            </div>
            <a href="login.html" class="btn-logout" onclick="sessionStorage.clear(); localStorage.clear();">Salir</a>
        </div>
    </header>`;
}

// ── Process each file ─────────────────────────────────────────────────────────
files.forEach(file => {
    let content = fs.readFileSync(path.join(viewsDir, file), 'utf-8');

    const role = getRoleForFile(file);
    const topbarHtml = buildTopbar(role, file);

    const topbarRegex = /<header class="topbar">[\s\S]*?<\/header>/g;

    let replaced = false;
    content = content.replace(topbarRegex, () => {
        if (!replaced) { replaced = true; return topbarHtml; }
        return ''; // remove duplicate headers (buscar_siniestros had two)
    });

    if (!replaced) {
        content = content.replace(/<body[^>]*>/i, match => match + '\n' + topbarHtml);
    }

    // Inject global CSS link if not already present
    const cssLink = '<link rel="stylesheet" href="topbar_global.css">\n';
    if (!content.includes('topbar_global.css')) {
        content = content.replace(/<\/head>/i, '    ' + cssLink + '</head>');
    }

    fs.writeFileSync(path.join(viewsDir, file), content, 'utf-8');
    console.log('Updated', file, '→', role);
});

console.log('\nDone — all views updated with role-specific menus.');
