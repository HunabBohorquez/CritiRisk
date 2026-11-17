# CritiRisk — Ruta Crítica (CPM) y Simulación de Riesgo Monte Carlo

> **Enlaces del proyecto**

**Link:** `https://hunabbohorquez.github.io/CritiRisk/`

**Repositorio en GitHub:** `https://github.com/HunabBohorquez/CritiRisk`

> 📝 **Nota:** este proyecto tiene los **mismos archivos** que el repositorio de GitLab
> (`index.html`, `styles.css`, `app.js`, `README.md`). Solo cambia la plataforma de alojamiento.

---

## Descripción

**CritiRisk** es una aplicación web que analiza redes de proyecto con los métodos **CPM/PERT**, dibuja un **diagrama de Gantt** en `<canvas>` y estima el riesgo de retraso con una **simulación Monte Carlo** de 2,000 iteraciones. Está hecha solo con HTML5, CSS3 y JavaScript ES6+ (sin frameworks ni librerías).

Funciones principales:

- CRUD de tareas (ID, nombre, predecesoras, O, M, P).
- Validación con el algoritmo de Kahn: detecta IDs inexistentes y bloquea ciclos.
- Cálculo de te, ES, EF, LS, LF, holgura total y ruta crítica.
- Gantt con tareas críticas (naranja), no críticas (azul) y holgura (barra punteada tenue).
- Monte Carlo: probabilidad de cumplir una fecha límite, media, P90, índice de criticidad e histograma.
- Persistencia en `localStorage`, proyecto demo y exportación a JSON.

## Formulación matemática

**PERT** (tiempo esperado y varianza de cada tarea):

```
te = (O + 4·M + P) / 6        σ² = ((P − O) / 6)²
```

**CPM** (sobre el orden topológico):

```
ES(i) = max{ EF(j) : j ∈ predecesoras(i) }   (0 si no tiene)
EF(i) = ES(i) + te(i)
LF(i) = min{ LS(k) : k ∈ sucesoras(i) }       (duración total si no tiene)
LS(i) = LF(i) − te(i)
Holgura(i) = LS(i) − ES(i)
```

Una tarea es **crítica** si `Holgura ≤ 0.001`. Duración del proyecto = `max EF`.

**Distribución triangular** (O, M, P) por el método de la transformada inversa, con `u ~ U(0,1)` y `c = (M − O)/(P − O)`:

```
x = O + √( u·(P − O)·(M − O) )          si u < c
x = P − √( (1 − u)·(P − O)·(P − M) )    si u ≥ c
```

En cada iteración se recalcula toda la red con las duraciones muestreadas. Con las N corridas:

- **Probabilidad** = corridas con duración ≤ fecha límite / N
- **P90** = valor en la posición ⌈0.9·N⌉ de las duraciones ordenadas
- **Índice de criticidad** = corridas donde la tarea tuvo holgura ≤ 0.001 / N

## Instrucciones de ejecución

1. Guarda `index.html`, `styles.css`, `app.js` y `README.md` en la misma carpeta.
2. Abre `index.html` en cualquier navegador moderno. No requiere servidor ni instalación.
3. Pulsa **Cargar Proyecto Demo**, o agrega tus propias tareas.
4. Escribe la **Fecha Límite Objetivo** y pulsa **Ejecutar Simulación Monte Carlo**.

## Pruebas Verificables

Al pulsar **Cargar Proyecto Demo** deben obtenerse exactamente estos valores:

| ID | Nombre | Pred. | O | M | P | te | ES | EF | LS | LF | Holgura | Crítica |
|----|--------|-------|---|---|---|----|----|----|----|----|---------|---------|
| T1 | Análisis de requisitos | — | 1 | 2 | 3 | 2 | 0 | 2 | 0 | 2 | 0 | Sí |
| T2 | Diseño del sistema | T1 | 2 | 4 | 6 | 4 | 2 | 6 | 2 | 6 | 0 | Sí |
| T3 | Compra de equipo | T1 | 1 | 3 | 5 | 3 | 2 | 5 | 7 | 10 | 5 | No |
| T4 | Desarrollo backend | T2 | 4 | 6 | 8 | 6 | 6 | 12 | 6 | 12 | 0 | Sí |
| T5 | Desarrollo frontend | T2 | 3 | 5 | 7 | 5 | 6 | 11 | 7 | 12 | 1 | No |
| T6 | Infraestructura | T3 | 1 | 2 | 3 | 2 | 5 | 7 | 10 | 12 | 5 | No |
| T7 | Integración y pruebas | T4, T5, T6 | 2 | 3 | 4 | 3 | 12 | 15 | 12 | 15 | 0 | Sí |
| T8 | Despliegue | T7 | 1 | 2 | 3 | 2 | 15 | 17 | 15 | 17 | 0 | Sí |

- **Duración esperada del proyecto:** 17 días.
- **Ruta crítica:** T1 → T2 → T4 → T7 → T8.
- **Monte Carlo (valores aproximados, varían entre corridas):** con fecha límite de 17 días la probabilidad ronda el 50–60 %; la media se acerca a 17 días; T1, T2, T4, T7 y T8 tienen un índice de criticidad cercano o superior al 90 %, T5 tiene un valor intermedio y T3 y T6 tienen valores bajos.
- **Pruebas de validación:** una predecesora inexistente (por ejemplo `T99`) o un ciclo (T1 depende de T8) muestran una alerta y no se guardan.
