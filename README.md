# ChatGPT & Dots — Citar selección

Userscript 1.0.2 para añadir fragmentos seleccionados al borrador **exclusivamente
en Dots**, en `chatgpt.com/dots` y `chatgpt.com/dots/...`.
No se activa en chats normales, proyectos, GPTs ni en la página principal.

[Instalar / actualizar el userscript](https://raw.githubusercontent.com/alexx-ftw/chatgpt-quote-reply/main/chatgpt-quote-reply.user.js)

**Estado:** revisado estáticamente y acompañado de pruebas de lógica y de interfaz.
Las pruebas de navegador y la compatibilidad con el dot real están pendientes:
este entorno bloqueó la inspección de chatgpt.com y el arranque de Chromium.
No se debe interpretar el soporte diseñado para dots como compatibilidad comprobada en vivo.

## Instalación

1. Con Tampermonkey o Violentmonkey instalado, abre el enlace **Instalar / actualizar**.
2. Confirma **Instalar** o **Actualizar** en tu gestor. Se mantienen el nombre y
   el espacio de nombres de la versión 1.0.0 para que pueda reconocerla.
3. Comprueba que quede una única copia activada y tenga acceso a chatgpt.com.
4. Recarga la pestaña de tu dot. Si entras desde un chat normal sin que la página
   se recargue, recarga una vez dentro de Dots para que el gestor inyecte el script.

Si el navegador solo muestra texto, importa el archivo descargado desde el gestor,
o sustituye **todo** el contenido del script antiguo por el archivo completo.
`chatgpt-quote-reply.user.js.txt` contiene exactamente el mismo código.
No pegues la página de GitHub, el README, el archivo `.meta.js` ni bloques incompletos.

No hace falta una API key. No instala extensiones ni modifica tus otros scripts.
No instales a la vez dos copias de esta misma versión.

## Actualizaciones automáticas

El gestor consulta `@updateURL` (el archivo pequeño `.meta.js`) y descarga el
userscript completo desde `@downloadURL` cuando hay una versión posterior.
Ambos apuntan a este repositorio público en GitHub. No hay un actualizador propio
ni peticiones de actualización dentro del código que se ejecuta en ChatGPT.

Mantén activada la comprobación de actualizaciones en tu gestor. La periodicidad
depende de su configuración; también puedes usar **Buscar actualizaciones**.
La versión 1.0.0, instalada sin estas URLs, necesita esta actualización manual
una vez. Las futuras versiones publicadas con un número mayor usarán estas URLs.

Para publicar una versión nueva, actualiza `@version` en ambos archivos,
el atributo `data-userscript-version` y el marcador final del `.user.js`;
sincroniza la copia `.txt` y ejecuta las pruebas antes de publicarla.

## Uso

- Selecciona texto de un mensaje y pulsa **Citar** en el nuevo menú flotante.
- La cita se añade al final del borrador, con espacio para escribir tu respuesta.
- Una inserción correcta es silenciosa: no aparece el aviso «Cita añadida al borrador».
- Puedes seleccionar otro fragmento y volver a pulsar **Citar** para acumular citas.
- Atajo alternativo: **Alt + Mayús + Q** mientras el texto siga seleccionado.
- **Copiar** copia la cita para pegarla donde quieras.
- Si no se puede reconocer o usar el editor con seguridad, aparece un panel
  con la cita preparada. Usa su botón de copia o Ctrl+C / Cmd+C.
- Escape cierra el menú o el panel.

Ejemplo del texto añadido al mensaje:

```text
> Fragmento seleccionado de la respuesta.

Aquí escribes tu pregunta.
```

El script **nunca pulsa Enviar**, ni simula Enter. El envío sigue siendo manual.
Otros scripts o extensiones instalados pueden tener comportamientos propios.

## Diseño y límites

- Los únicos patrones de instalación son `https://chatgpt.com/dots` y
  `https://chatgpt.com/dots/*`. También comprueba la ruta al ejecutarse y al citar.
- Si sales de Dots por navegación interna sin recargar, se oculta la interfaz
  del script, se descarta la selección pendiente y se desactivan sus acciones.
- Intenta reconocer tanto el editor habitual como un editor editable único
  situado en la zona principal, incluso sin `<form>` ni `#prompt-textarea`.
- No elige un campo arbitrario cuando hay varios candidatos ambiguos.
- Inserta al final del editor enriquecido mediante la operación nativa de
  edición; no reconstruye ni sustituye su HTML para añadir una cita.
- Para un textarea conserva el contenido anterior completo. La alternativa
  de inserción respeta cancelaciones de `beforeinput` y no reintenta una
  edición que ya produjo `input` y fue revertida.
- No lee cookies, claves, historial ni almacenamiento. No guarda selecciones.
- No realiza peticiones de red, no añade dependencias remotas y no intercepta
  `fetch`, XHR ni las APIs de ChatGPT.
- Solo escribe en el portapapeles cuando pulsas un botón de copia.
- Las citas son **texto Markdown**, no referencias nativas: no crean hilos,
  metadatos privados ni enlaces persistentes al mensaje original.
- Al citar selecciones de más de 50.000 caracteres, pide acortar la selección;
  no trunca ni envía silenciosamente el contenido.
- El cambio de conversación o del fragmento invalida la selección pendiente.
- El formato copiado es texto, no HTML, imágenes ni fórmulas estructuradas.
- No admite selecciones múltiples no contiguas de Firefox en una sola acción;
  puedes añadir cada fragmento por separado.
- Usa `document.execCommand('insertText')`, una API antigua aún utilizada para
  editores enriquecidos. Si el navegador/editor la rechaza, ofrece copia manual.
- No pretende sortear restricciones de un sitio, un navegador o un administrador.

## Si no aparece o no inserta

1. Recarga después de instalar y confirma que estás en la sección Dots de chatgpt.com.
2. Selecciona una frase de un mensaje, no el texto del propio borrador o de la barra lateral.
3. Prueba el atajo Alt + Mayús + Q.
4. Si hay varios editores, haz clic en el cuadro donde quieres escribir y vuelve
   a seleccionar el fragmento del mensaje.
5. Usa **Copiar** o el panel manual si el editor sigue sin reconocerse.

Si necesitas reportar un fallo, basta indicar el navegador, si es chat normal o dot,
y qué sucede al seleccionar/pulsar Citar. No hacen falta cookies ni credenciales.

### Error «Unexpected end of input» al abrir ChatGPT

Ese mensaje indica que el navegador no pudo analizar el código que recibió.
Puede deberse a una copia incompleta o modificada, o a cómo la inyecta el gestor;
el mensaje por sí solo no identifica cuál de esas causas es la responsable.

Reinstala desde el enlace directo para utilizar el archivo completo y comprobado.
En 1.0.2 su última línea es `// END CHATGPT-QUOTE-REPLY 1.0.2`. Una vez ejecutado,
el elemento `#chatgpt-quote-reply` lleva `data-userscript-version="1.0.2"`.
Si persiste el error, exporta solo este userscript desde el gestor para comparar
la copia instalada con la publicada; no hace falta exportar otros scripts ni ajustes.

Un aviso distinto sobre `sentinel/sdk.js` que indique **report-only** no está
bloqueando esa carga. No desactives CSP ni protecciones del navegador para instalarlo.

## Comprobaciones incluidas

Las pruebas comprueban la sintaxis del archivo distribuido, la coherencia de sus
metadatos de actualización y el éxito silencioso, además de la lógica de citas.
Los 16 escenarios de interfaz están preparados pero no ejecutados satisfactoriamente,
porque el navegador no pudo arrancar en este entorno.

- Sintaxis: `node --check chatgpt-quote-reply.user.js`.
- Lógica sin navegador: `node --test tests/quote-reply.unit.cjs`.
- Interfaz (pendiente): `node --test tests/quote-reply.spec.cjs`, con Playwright
  y Chromium disponibles en el equipo donde se ejecute.

La suite de interfaz usa páginas sintéticas locales; no abre chatgpt.com,
no usa sesiones autenticadas y no demuestra por sí sola compatibilidad con dots.
Las pruebas de lógica no sustituyen una prueba real del editor de ChatGPT.

## Alternativas y fuentes

- Nativo, chats normales: seleccionar texto → Ask ChatGPT / Preguntar a ChatGPT.
  https://community.openai.com/t/feature-request-ask-chatgpt-for-selected-text-in-the-current-chat-for-desktop-app/1387522
- Petición específica de citas para dots (abierta al revisar):
  https://github.com/openai/codex/issues/51276
- Extensión existente más cercana, Ask ChatGPT Multi:
  https://chromewebstore.google.com/detail/ask-chatgpt-multi/gfimipjodfpoeocpboomepjgmocigfjb
  https://github.com/pranay0064/chatgpt-ask-multi

Este script es una implementación independiente. No está afiliado a OpenAI.

## Cambios en 1.0.1

- Publicación en GitHub con enlaces estables de instalación y actualización.
- Metadatos `@updateURL` y `@downloadURL`; archivo `.meta.js` para el gestor.
- Eliminado el aviso de éxito al añadir una cita; se conservan avisos de error y copia.
- Versión identificable en el elemento raíz y marcador final para comprobar la copia.
- Pruebas de distribución y de inserción silenciosa.

## Cambios en 1.0.2

- Restricción exclusiva a Dots tanto en `@match` como en las comprobaciones internas.
- Desactivación de acciones y limpieza de la interfaz al salir de Dots por navegación interna.
- Conserva las actualizaciones automáticas y la inserción silenciosa.

## Desinstalación

Desactiva o elimina el script en tu gestor y recarga ChatGPT. No hay datos
persistentes del script que limpiar. Los mensajes que tú hayas enviado permanecen
en sus conversaciones.
