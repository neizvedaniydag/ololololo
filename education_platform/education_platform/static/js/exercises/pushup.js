export const pushup = {
    name: 'pushup',
    title: 'Отжимания',
    defaultReps: 10,

    instructions: [
        'Упор лежа на прямых руках',
        'Тело образует прямую линию',
        'Опуститесь грудью почти до пола',
        'Локти согнуты на 90 градусов',
        'Выпрямите руки полностью'
    ],

    svgIcons: {
        bodyDown: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 10 L32 40 M26 34 L32 40 L38 34" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="42" width="8" height="3"/></svg>',
        bodyUp: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 40 L32 10 M26 16 L32 10 L38 16" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="8" width="8" height="3"/></svg>',
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/><circle cx="20" cy="30" r="3"/><circle cx="44" cy="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7-1.41-1.41z"/></svg>'
    },

    thresholds: {
        // ИЗ НАУЧНОГО ИССЛЕДОВАНИЯ (web:212)
        elbowMin: 70,      // Меньше = слишком глубоко
        elbowMax: 100,     // Больше = недостаточно глубоко
        elbowUp: 160,      // Выпрямлены
        
        bodyMin: 160,      // Тело прямое
        bodyMax: 200
    },

    getInitialState() {
        return { 
            position: 'up',
            debugMode: true  // ВКЛЮЧИТЬ ОТЛАДКУ
        };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        // Углы локтей (плечо-локоть-запястье)
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = (elbowLeft + elbowRight) / 2;
        
        // Угол тела (плечо-таз-ЛОДЫЖКА как в исследовании!)
        const bodyLeft = calcAngle(lm[11], lm[23], lm[27]);
        const bodyRight = calcAngle(lm[12], lm[24], lm[28]);
        const body = (bodyLeft + bodyRight) / 2;

        // === ОТЛАДКА - ПОКАЗАТЬ РЕАЛЬНЫЕ УГЛЫ ===
        if (state.debugMode) {
            console.log(`ОТЛАДКА: Локоть=${Math.round(elbow)}° | Тело=${Math.round(body)}° | Позиция=${state.position}`);
        }

        let result = { counted: false, correct: false, status: 'Готов' };

        // ==== ОПУСКАНИЕ ====
        if (state.position === 'up' && elbow <= this.thresholds.elbowMax) {
            state.position = 'down';
            result.counted = true;
            result.status = 'ОПУСТИЛИСЬ!';
            
            // Проверка глубины
            if (elbow < this.thresholds.elbowMin) {
                showHint(`Слишком глубоко! (${Math.round(elbow)}°)`, this.svgIcons.bodyUp, 'rgba(245, 158, 11, 0.95)');
                result.correct = true; // ВСЁ РАВНО ЗАЧЁТ!
            }
            // Проверка тела
            else if (body < this.thresholds.bodyMin) {
                showHint(`Спина прогнута! (${Math.round(body)}°)`, this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                logError('Прогиб в спине');
                result.correct = false;
            }
            else if (body > this.thresholds.bodyMax) {
                showHint(`Таз высоко! (${Math.round(body)}°)`, this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                logError('Таз слишком высоко');
                result.correct = false;
            }
            // ВСЁ ОТЛИЧНО
            else {
                showHint(`ОТЛИЧНО! (${Math.round(elbow)}°)`, this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
                result.correct = true; 
            }
        }
        // ==== ПОДЪЁМ ====
        else if (state.position === 'down' && elbow >= this.thresholds.elbowUp) {
            state.position = 'up';
            showHint('ГОТОВ!', this.svgIcons.bodyDown, 'rgba(16, 185, 129, 0.95)');
            result.status = 'Готов';
        }
        // ==== ПРОМЕЖУТОЧНЫЕ ====
        else {
            if (state.position === 'up') {
                result.status = `Опускайтесь (${Math.round(elbow)}°)`;
            } else {
                result.status = `Выпрямляйте (${Math.round(elbow)}°)`;
            }
        }

        return result;
    }
};
