# Contexto del Proyecto: Sistema de Gestión de Siniestros de Autos

## 📌 Descripción General
Este proyecto es una plataforma web desarrollada en **PHP y MySQL** para la gestión integral de siniestros de seguros de automóviles. El sistema permite el seguimiento completo desde el reporte inicial hasta el pago o entrega de la unidad.

## 👥 Roles de Usuario y Permisos
El sistema debe manejar tres perfiles con acceso diferenciado:

1.  **Ajustadores:**
    * Registran el siniestro con datos detallados.
    * Cargan material multimedia (fotos y videos).
    * Solo pueden ver y consultar los siniestros que ellos mismos registraron.
2.  **Supervisores:**
    * Revisan la documentación y multimedia cargada por el ajustador.
    * Autorizan pagos, determinan reparaciones o declaran pérdida total.
    * Gestionan fechas de compromiso y suben evidencia de reparaciones.
    * Tienen visibilidad global de todos los siniestros en el sistema.
3.  **Asegurados:**
    * Clientes finales que dan seguimiento a su unidad.
    * Realizan comentarios o preguntas en el flujo del siniestro.
    * Solo pueden visualizar sus propios siniestros.

## 🔐 Especificaciones de Usuario y Seguridad
* **Datos obligatorios:** Nombre, Apellidos, Fecha de nacimiento (Validación: >18 años), Foto de perfil, Género, Correo electrónico, Contraseña y Alias.
* **Seguridad:** * Las contraseñas deben estar encriptadas en la base de datos (se sugiere `password_hash` de PHP).
    * Implementar validación de sesiones para proteger las rutas según el rol.

## 🛠️ Flujo de Siniestros y Estados
Un siniestro debe transitar obligatoriamente por los siguientes estados gestionados por el Supervisor:
1.  **Rechazado**
2.  **Aceptado**
3.  **Aceptado con pago de deducible**
4.  **Aceptado sin pago de deducible**
5.  **Aplica pago para reparación**
6.  **Pérdida total (pago completo de la unidad)**

## 📋 Requerimientos de Datos por Siniestro
Al registrar un siniestro se debe capturar:
* Datos de la compañía de seguros y número de póliza.
* Datos del cliente y de la unidad (Placas, Serie, Modelo).
* Fecha, hora y ubicación exacta del evento.
* Involucrados (otras unidades).
* Descripción del asegurado y material multimedia (Ajustador).

## 🔍 Funcionalidades de Consulta y Búsqueda
* **Filtros de búsqueda:** Rango de fechas, compañía de seguros, ID de unidad (placas/serie) y usuario.
* **Vistas:** Listado general con opción de "Ver Detalle" para mostrar toda la multimedia y línea de tiempo de comentarios.
* **Lógica de visibilidad:** Las consultas SQL deben filtrar por `user_id` o `role_id` dependiendo de quién esté logueado.

## 💻 Restricciones Técnicas (Anexo 1)
* **Lenguaje:** PHP.
* **Base de Datos:** MySQL.
* **Arquitectura:** Debe ser modular y seguir buenas prácticas de limpieza de código para asegurar la aprobación del proyecto.

## 🤖 Instrucciones para Claude
Cuando te pida cambios o nuevas funciones:
1.  Asegúrate de que el código PHP sea compatible con la estructura de base de datos mencionada.
2.  Mantén siempre la restricción de visibilidad según el tipo de usuario.
3.  Si propongo un cambio en la UI, respeta el flujo de estados del siniestro.
4.  Genera explicaciones detalladas de cada bloque de código que añadas o modifiques.