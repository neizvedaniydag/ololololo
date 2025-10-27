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
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/>ircle cx="20" cy="30" r="3"3"/>ircle cx="44" cy="30" r="3"3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
        warning: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'
    },

    thresholds: {
        elbowDown: null,
        elbowUp: null,
        bodyAngleMin: 160,
        bodyAngleMax: 200,
        // NEW: Пороги для фильтрации
        minConfidence: 0.75,           // Минимальная уверенность MediaPipe
        kneeAngleMin: 150,             // Колени должны быть почти прямыми (не сидя!)
        wristBelowShoulderMin: 0.05,   // Запястья НИЖЕ плеч минимум на 5%
        headShoulderRatioMax: 0.95,    // Голова не должна быть слишком низко относительно плеч
        headShoulderRatioMin: 0.7,     // Голова не должна быть слишком высоко
        shoulderHipDiffMax: 0.15,      // Разница между плечами и бедрами (горизонтальность)
        ankleVisibilityMin: 0.5        // Лодыжки должны быть видны (не махать руками в кадре!)
    },

    getInitialState() {
        return { 
            position: 'up',
            calibrationStep: 0,
            calibrationSamples: [],
            calibratedMin: null,
            calibratedMax: null,
            failedChecks: 0,
            consecutiveValidFrames: 0  // NEW: Счетчик последовательных валидных кадров
        };
    },

    // NEW: Функция проверки видимости всех ключевых точек
    checkLandmarksVisibility(lm) {
        const criticalPoints = [
            0,  // нос
            11, 12,  // плечи
            13, 14,  // локти
            15, 16,  // запястья
            23, 24,  // бедра
            25, 26,  // колени
            27, 28   // лодыжки
        ];

        for (let idx of criticalPoints) {
            if (!lm[idx] || 
                (lm[idx].visibility !== undefined && lm[idx].visibility < this.thresholds.minConfidence)) {
                return { valid: false, reason: `Точка ${idx} не видна (visibility < ${this.thresholds.minConfidence})` };
            }
        }
        
        return { valid: true };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        
        // ========== ПРОВЕРКА #0: ВИДИМОСТЬ ВСЕХ ТОЧЕК ==========
        const visibilityCheck = this.checkLandmarksVisibility(lm);
        if (!visibilityCheck.valid) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌ ${visibilityCheck.reason} - встаньте в кадр полностью!`;
            showHint('Не все точки тела видны!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 60) state.position = 'up';
            return result;
        }

        // ========== БАЗОВЫЕ УГЛЫ ==========
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = Math.round((elbowLeft + elbowRight) / 2);

        // Угол тела (плечо-бедро-лодыжка)
        const bodyAngleLeft = calcAngle(lm[11], lm[23], lm[27]);
        const bodyAngleRight = calcAngle(lm[12], lm[24], lm[28]);
        const bodyAngle = Math.round((bodyAngleLeft + bodyAngleRight) / 2);

        // NEW: Угол коленей (бедро-колено-лодыжка)
        const kneeAngleLeft = calcAngle(lm[23], lm[25], lm[27]);
        const kneeAngleRight = calcAngle(lm[24], lm[26], lm[28]);
        const kneeAngle = Math.round((kneeAngleLeft + kneeAngleRight) / 2);

        // ========== КООРДИНАТЫ КЛЮЧЕВЫХ ТОЧЕК ==========
        const noseY = lm[0].y;
        const shoulderY = (lm[11].y + lm[12].y) / 2;
        const hipY = (lm[23].y + lm[24].y) / 2;
        const kneeY = (lm[25].y + lm[26].y) / 2;
        const ankleY = (lm[27].y + lm[28].y) / 2;
        
        const leftWristY = lm[15].y;
        const rightWristY = lm[16].y;
        const wristY = (leftWristY + rightWristY) / 2;

        // NEW: Положение рук относительно тела
        const leftShoulderX = lm[11].x;
        const rightShoulderX = lm[12].x;
        const leftWristX = lm[15].x;
        const rightWristX = lm[16].x;
        
        const shoulderWidth = Math.abs(rightShoulderX - leftShoulderX);
        const handWidth = Math.abs(rightWristX - leftWristX);
        const handWidthRatio = handWidth / shoulderWidth;

        // ========== ПРОВЕРКИ ПОЛОЖЕНИЯ ТЕЛА ==========
        const bodyHeightDiff = Math.abs(shoulderY - hipY);
        const isHorizontal = bodyHeightDiff < this.thresholds.shoulderHipDiffMax && noseY < hipY;

        // NEW: Синхронность движения локтей
        const elbowDiff = Math.abs(elbowLeft - elbowRight);
        const movementSynchronized = elbowDiff < 15;

        // NEW: Правильная ширина рук
        const handsPositionValid = handWidthRatio >= 1.0 && handWidthRatio <= 1.8;

        // NEW: Угол тела прямой
        const bodyLineCorrect = bodyAngle >= this.thresholds.bodyAngleMin && 
                                 bodyAngle <= this.thresholds.bodyAngleMax;

        let result = { counted: false, correct: false, status: '' };

        // ========== КАЛИБРОВКА ==========
        if (state.calibrationStep < 3) {
            if (!isHorizontal) {
                result.status = '⚠️ Встаньте в упор лёжа (планку)! Тело должно быть горизонтально';
                showHint('Встаньте в планку!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                return result;
            }

            if (state.calibrationStep === 0) {
                result.status = `📍 КАЛИБРОВКА: Опуститесь грудью к полу и держите 3 сек (тело: ${bodyAngle}°, колени: ${kneeAngle}°)`;
                showHint(`Опуститесь вниз! Локоть: ${elbow}°`, this.svgIcons.bodyDown, 'rgba(59, 130, 246, 0.95)');
                
                // Калибруем только если тело прямое И колени прямые
                if (bodyLineCorrect && kneeAngle >= this.thresholds.kneeAngleMin) {
                    state.calibrationSamples.push(elbow);
                }
                
                if (state.calibrationSamples.length >= 60) {
                    const sorted = state.calibrationSamples.sort((a, b) => a - b);
                    state.calibratedMin = sorted[Math.floor(sorted.length / 2)];
                    state.calibrationSamples = [];
                    state.calibrationStep = 1;
                }
            }
            else if (state.calibrationStep === 1) {
                result.status = `📍 КАЛИБРОВКА: Выпрямите руки полностью и держите 3 сек (тело: ${bodyAngle}°, колени: ${kneeAngle}°)`;
                showHint(`Выпрямите руки! Локоть: ${elbow}°`, this.svgIcons.bodyUp, 'rgba(59, 130, 246, 0.95)');
                
                // Калибруем только если тело прямое И колени прямые
                if (bodyLineCorrect && kneeAngle >= this.thresholds.kneeAngleMin) {
                    state.calibrationSamples.push(elbow);
                }
                
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

        // ========== ОБЫЧНЫЙ РЕЖИМ С МАКСИМАЛЬНЫМИ ПРОВЕРКАМИ ==========
        
        // КРИТИЧЕСКАЯ ПРОВЕРКА #1: ПОЛОЖЕНИЕ СИДЯ (согнутые колени)
        if (kneeAngle < this.thresholds.kneeAngleMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ ВЫ СИДИТЕ! Колени согнуты: ${kneeAngle}° (нужно >${this.thresholds.kneeAngleMin}°)`;
            showHint('НЕЛЬЗЯ ОТЖИМАТЬСЯ СИДЯ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // КРИТИЧЕСКАЯ ПРОВЕРКА #2: РУКИ В ВОЗДУХЕ (махание руками, игры с пальцами)
        const wristBelowShoulder = wristY - shoulderY;
        if (wristBelowShoulder < this.thresholds.wristBelowShoulderMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ РУКИ В ВОЗДУХЕ! Опустите руки на пол! Разница: ${(wristBelowShoulder * 100).toFixed(1)}%`;
            showHint('Руки должны быть НА ПОЛУ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // КРИТИЧЕСКАЯ ПРОВЕРКА #3: НАКЛОНЫ ГОЛОВЫ (голова слишком низко/высоко)
        const headShoulderRatio = noseY / shoulderY;
        if (headShoulderRatio > this.thresholds.headShoulderRatioMax || 
            headShoulderRatio < this.thresholds.headShoulderRatioMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            
            if (headShoulderRatio > this.thresholds.headShoulderRatioMax) {
                result.status = `❌ ГОЛОВА СЛИШКОМ НИЗКО! Не кивайте головой! Соотношение: ${headShoulderRatio.toFixed(2)}`;
            } else {
                result.status = `❌ ГОЛОВА СЛИШКОМ ВЫСОКО! Держите голову нейтрально! Соотношение: ${headShoulderRatio.toFixed(2)}`;
            }
            showHint('НЕ ДВИГАЙТЕ ГОЛОВОЙ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА #4: Тело не горизонтально
        if (!isHorizontal) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = '❌ Встаньте в упор лёжа! НЕ СЧИТАЕТСЯ';
            showHint('Примите правильное положение!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА #5: Тело не прямое (таз провисает или поднят)
        if (!bodyLineCorrect) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (bodyAngle < this.thresholds.bodyAngleMin) {
                result.status = `❌ Опустите таз! Угол тела: ${bodyAngle}° (нужно >${this.thresholds.bodyAngleMin}°)`;
            } else {
                result.status = `❌ Поднимите таз! Угол тела: ${bodyAngle}° (нужно <${this.thresholds.bodyAngleMax}°)`;
            }
            showHint('Держите тело прямо!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА #6: Руки поставлены неправильно
        if (!handsPositionValid) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (handWidthRatio < 1.0) {
                result.status = `❌ Руки слишком узко! Разведите шире плеч (${handWidthRatio.toFixed(2)})`;
            } else {
                result.status = `❌ Руки слишком широко! Поставьте уже (${handWidthRatio.toFixed(2)})`;
            }
            showHint('Неправильная постановка рук!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА #7: Движение несинхронное
        if (!movementSynchronized) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ Движение несинхронное! Разница локтей: ${elbowDiff}°`;
            showHint('Опускайтесь равномерно!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            return result;
        }

        // ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ - увеличиваем счётчик валидных кадров
        state.consecutiveValidFrames++;
        state.failedChecks = 0;

        // NEW: Засчитываем повторение ТОЛЬКО если было минимум 5 последовательных валидных кадров
        const minValidFrames = 5;

        // ОПУСКАНИЕ - засчитываем только если ВСЕ условия выполнены И было достаточно валидных кадров
        if (state.position === 'up' && elbow < this.thresholds.elbowDown) {
            if (state.consecutiveValidFrames >= minValidFrames) {
                state.position = 'down';
                result.counted = true;
                result.correct = true;
                result.status = `✅ ЗАСЧИТАНО! Локоть: ${elbow}°, Тело: ${bodyAngle}°, Колени: ${kneeAngle}°`;
                showHint('✅ ОТЛИЧНО!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
            } else {
                result.status = `⏳ Удерживайте позицию... (${state.consecutiveValidFrames}/${minValidFrames} кадров)`;
            }
        } 
        // ПОДЪЁМ
        else if (state.position === 'down' && elbow > this.thresholds.elbowUp) {
            state.position = 'up';
            result.status = `✅ Готов к следующему! (${elbow}°)`;
            showHint('Готов к следующему', this.svgIcons.bodyDown);
        }
        // ПРОМЕЖУТОЧНОЕ
        else {
            if (state.position === 'up') {
                result.status = `⬇️ Опускайтесь! Локоть: ${elbow}° → <${this.thresholds.elbowDown}°`;
            } else {
                result.status = `⬆️ Выпрямляйтесь! Локоть: ${elbow}° → >${this.thresholds.elbowUp}°`;
            }
        }

        return result;
    }
};
