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
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    },

    thresholds: {
        elbowDown: null,
        elbowUp: null
    },

    getInitialState() {
        return { 
            position: 'up',
            calibrationStep: 0,
            calibrationSamples: [],
            calibratedMin: null,
            calibratedMax: null
        };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = Math.round((elbowLeft + elbowRight) / 2);

        // ========== ПРОВЕРКА ПОЛОЖЕНИЯ ТЕЛА ==========
        // Проверяем что тело горизонтально (в позиции для отжиманий)
        const shoulderY = (lm[11].y + lm[12].y) / 2;  // Плечи
        const hipY = (lm[23].y + lm[24].y) / 2;       // Бёдра
        const noseY = lm[0].y;                         // Нос
        
        // Разница по высоте между плечами и бёдрами должна быть небольшой
        const bodyHeightDiff = Math.abs(shoulderY - hipY);
        
        // Нос должен быть выше бёдер (человек не стоит вертикально)
        const isHorizontal = bodyHeightDiff < 0.15 && noseY < hipY;

        let result = { counted: false, correct: false, status: '' };

        // ========== КАЛИБРОВКА ==========
        if (state.calibrationStep < 3) {
            if (!isHorizontal) {
                result.status = '⚠️ Встаньте в упор лёжа (планку)! Тело должно быть горизонтально';
                showHint('Встаньте в планку!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                return result;
            }

            if (state.calibrationStep === 0) {
                result.status = '📍 КАЛИБРОВКА: Опуститесь грудью к полу и держите 3 сек';
                showHint(`Опуститесь вниз! Угол: ${elbow}°`, this.svgIcons.bodyDown, 'rgba(59, 130, 246, 0.95)');
                
                state.calibrationSamples.push(elbow);
                
                if (state.calibrationSamples.length >= 60) {
                    const sorted = state.calibrationSamples.sort((a, b) => a - b);
                    state.calibratedMin = sorted[Math.floor(sorted.length / 2)];
                    state.calibrationSamples = [];
                    state.calibrationStep = 1;
                }
            }
            else if (state.calibrationStep === 1) {
                result.status = '📍 КАЛИБРОВКА: Выпрямите руки полностью и держите 3 сек';
                showHint(`Выпрямите руки! Угол: ${elbow}°`, this.svgIcons.bodyUp, 'rgba(59, 130, 246, 0.95)');
                
                state.calibrationSamples.push(elbow);
                
                if (state.calibrationSamples.length >= 60) {
                    const sorted = state.calibrationSamples.sort((a, b) => a - b);
                    state.calibratedMax = sorted[Math.floor(sorted.length / 2)];
                    state.calibrationSamples = [];
                    
                    const range = state.calibratedMax - state.calibratedMin;
                    this.thresholds.elbowDown = state.calibratedMin + Math.round(range * 0.3);
                    this.thresholds.elbowUp = state.calibratedMax - Math.round(range * 0.15);
                    
                    state.calibrationStep = 2;
                }
            }
            else if (state.calibrationStep === 2) {
                result.status = `✅ Калибровка завершена! Низ: ${state.calibratedMin}°, Верх: ${state.calibratedMax}°`;
                showHint('✅ Калибровка готова! Начинайте!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
                
                setTimeout(() => {
                    state.calibrationStep = 3;
                }, 2000);
            }
            
            return result;
        }

        // ========== ОБЫЧНЫЙ РЕЖИМ ==========
        
        // БЛОКИРОВКА: Если тело не горизонтально - НЕ СЧИТАЕМ!
        if (!isHorizontal) {
            result.status = '⚠️ Встаньте в упор лёжа! Не считается';
            showHint('Примите правильное положение!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
            return result;
        }

        // ОПУСКАНИЕ
        if (state.position === 'up' && elbow < this.thresholds.elbowDown) {
            state.position = 'down';
            result.counted = true;
            result.correct = true;
            result.status = `✅ ЗАСЧИТАНО! (${elbow}°)`;
            showHint('✅ ОТЛИЧНО!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
        } 
        // ПОДЪЁМ
        else if (state.position === 'down' && elbow > this.thresholds.elbowUp) {
            state.position = 'up';
            result.status = `Готов! (${elbow}°)`;
            showHint('Готов к следующему', this.svgIcons.bodyDown);
        }
        // ПРОМЕЖУТОЧНОЕ
        else {
            if (state.position === 'up') {
                result.status = `⬇️ Опускайтесь! ${elbow}° (нужно <${this.thresholds.elbowDown}°)`;
            } else {
                result.status = `⬆️ Выпрямляйтесь! ${elbow}° (нужно >${this.thresholds.elbowUp}°)`;
            }
        }

        return result;
    }
};
