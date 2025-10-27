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
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/>ircle cx="2020" cy="30" r="3"/>ircle cx="4444" cy="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
        warning: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'
    },

    thresholds: {
        elbowDown: null,
        elbowUp: null,
        bodyAngleMin: 160,
        bodyAngleMax: 200,
        minConfidence: 0.6,
        kneeAngleMin: 150,
        wristBelowShoulderMin: 0.05,
        headShoulderRatioMax: 0.95,
        headShoulderRatioMin: 0.7,
        shoulderHipDiffMax: 0.15,
        // NEW: КРИТИЧЕСКИЕ пороги для защиты от сидения
        minBodyAspectRatio: 1.5,         // Тело ДОЛЖНО быть ГОРИЗОНТАЛЬНЫМ (ширина > высоты в 1.5 раза)
        maxBodyAspectRatio: 4.0,         // Но не слишком широким (не только верх тела)
        minNoseToAnkleDistance: 0.4,     // Расстояние от носа до лодыжек минимум 40% от ширины кадра
        shoulderMaxYPosition: 0.7,       // Плечи не должны быть выше 70% кадра (при сидении они в центре/верху)
        ankleMinYPosition: 0.5,          // Лодыжки должны быть ниже 50% кадра
        wristNoseYDiffMax: 0.15          // Запястья и нос должны быть примерно на одном уровне по Y (±15%)
    },

    getInitialState() {
        return { 
            position: 'up',
            calibrationStep: 0,
            calibrationSamples: [],
            calibratedMin: null,
            calibratedMax: null,
            failedChecks: 0,
            consecutiveValidFrames: 0,
            lastErrorType: null  // NEW: Тип последней ошибки
        };
    },

    // NEW: Функция для вычисления расстояния между точками
    calculateDistance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    },

    // NEW: Функция проверки видимости критических точек
    checkLandmarksVisibility(lm) {
        const criticalPoints = [
            { idx: 0, name: 'нос' },
            { idx: 11, name: 'левое плечо' },
            { idx: 12, name: 'правое плечо' },
            { idx: 13, name: 'левый локоть' },
            { idx: 14, name: 'правый локоть' },
            { idx: 15, name: 'левое запястье' },
            { idx: 16, name: 'правое запястье' },
            { idx: 23, name: 'левое бедро' },
            { idx: 24, name: 'правое бедро' },
            { idx: 25, name: 'левое колено' },
            { idx: 26, name: 'правое колено' },
            { idx: 27, name: 'левая лодыжка' },
            { idx: 28, name: 'правая лодыжка' }
        ];

        for (let point of criticalPoints) {
            if (!lm[point.idx]) {
                return { valid: false, reason: `${point.name} не обнаружен` };
            }
            if (lm[point.idx].visibility !== undefined && lm[point.idx].visibility < this.thresholds.minConfidence) {
                return { valid: false, reason: `${point.name} плохо виден (${(lm[point.idx].visibility * 100).toFixed(0)}%)` };
            }
        }
        
        return { valid: true };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        
        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #0: ВИДИМОСТЬ ВСЕХ ТОЧЕК ==========
        const visibilityCheck = this.checkLandmarksVisibility(lm);
        if (!visibilityCheck.valid) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (state.lastErrorType !== 'visibility') {
                state.lastErrorType = 'visibility';
            }
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌ ${visibilityCheck.reason}! Встаньте в кадр ПОЛНОСТЬЮ!`;
            showHint('ВСЁ ТЕЛО должно быть видно!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 90) state.position = 'up';
            return result;
        }

        // ========== ПОЛУЧЕНИЕ КООРДИНАТ ==========
        const noseY = lm[0].y;
        const shoulderY = (lm[11].y + lm[12].y) / 2;
        const shoulderLeft = lm[11];
        const shoulderRight = lm[12];
        const hipY = (lm[23].y + lm[24].y) / 2;
        const ankleLeft = lm[27];
        const ankleRight = lm[28];
        const ankleY = (ankleLeft.y + ankleRight.y) / 2;
        const wristY = (lm[15].y + lm[16].y) / 2;
        const kneeY = (lm[25].y + lm[26].y) / 2;

        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #1: ASPECT RATIO (ГОРИЗОНТАЛЬНОСТЬ) ==========
        // Вычисляем ширину и высоту тела
        const bodyWidth = Math.max(
            Math.abs(shoulderRight.x - shoulderLeft.x),
            Math.abs(lm[16].x - lm[15].x),
            Math.abs(ankleRight.x - ankleLeft.x)
        );
        const bodyHeight = Math.abs(ankleY - noseY);
        const bodyAspectRatio = bodyWidth / bodyHeight;

        if (bodyAspectRatio < this.thresholds.minBodyAspectRatio) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (state.lastErrorType !== 'aspect') {
                state.lastErrorType = 'aspect';
            }
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌❌❌ ВЫ СИДИТЕ ИЛИ СТОИТЕ! Тело вертикальное! Соотношение: ${bodyAspectRatio.toFixed(2)} (нужно >${this.thresholds.minBodyAspectRatio})`;
            showHint('ЛЯГТЕ ГОРИЗОНТАЛЬНО!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (bodyAspectRatio > this.thresholds.maxBodyAspectRatio) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌ Только верх тела в кадре! Соотношение: ${bodyAspectRatio.toFixed(2)} (макс ${this.thresholds.maxBodyAspectRatio})`;
            showHint('Покажите ВСЁ ТЕЛО!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #2: РАССТОЯНИЕ ОТ НОСА ДО ЛОДЫЖЕК ==========
        const noseToAnkleDistLeft = this.calculateDistance(lm[0], ankleLeft);
        const noseToAnkleDistRight = this.calculateDistance(lm[0], ankleRight);
        const noseToAnkleDist = (noseToAnkleDistLeft + noseToAnkleDistRight) / 2;

        if (noseToAnkleDist < this.thresholds.minNoseToAnkleDistance) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (state.lastErrorType !== 'distance') {
                state.lastErrorType = 'distance';
            }
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌❌ ТЕЛО НЕ РАСТЯНУТО! Расстояние нос-лодыжки: ${(noseToAnkleDist * 100).toFixed(1)}% (нужно >${this.thresholds.minNoseToAnkleDistance * 100}%)`;
            showHint('РАСТЯНИТЕ ТЕЛО В ПЛАНКЕ!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #3: ПЛЕЧИ В НИЖНЕЙ ЧАСТИ КАДРА ==========
        if (shoulderY < this.thresholds.shoulderMaxYPosition) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (state.lastErrorType !== 'shoulderPos') {
                state.lastErrorType = 'shoulderPos';
            }
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌❌ ПЛЕЧИ СЛИШКОМ ВЫСОКО В КАДРЕ! Позиция: ${(shoulderY * 100).toFixed(0)}% (нужно >${this.thresholds.shoulderMaxYPosition * 100}%)`;
            showHint('ВЫ СИДИТЕ/СТОИТЕ!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #4: ЛОДЫЖКИ В НИЖНЕЙ ЧАСТИ КАДРА ==========
        if (ankleY < this.thresholds.ankleMinYPosition) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌ ЛОДЫЖКИ СЛИШКОМ ВЫСОКО! Позиция: ${(ankleY * 100).toFixed(0)}%`;
            showHint('Ноги должны быть ВНИЗУ кадра!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #5: ЗАПЯСТЬЯ И НОС НА ОДНОМ УРОВНЕ ==========
        const wristNoseYDiff = Math.abs(wristY - noseY);
        if (wristNoseYDiff > this.thresholds.wristNoseYDiffMax) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            if (state.lastErrorType !== 'wristLevel') {
                state.lastErrorType = 'wristLevel';
            }
            let result = { counted: false, correct: false, status: '' };
            result.status = `❌❌ РУКИ НЕ НА УРОВНЕ ГОЛОВЫ! Разница: ${(wristNoseYDiff * 100).toFixed(1)}% (макс ${this.thresholds.wristNoseYDiffMax * 100}%)`;
            showHint('РУКИ И ГОЛОВА НА ОДНОМ УРОВНЕ!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ========== БАЗОВЫЕ УГЛЫ ==========
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = Math.round((elbowLeft + elbowRight) / 2);

        const bodyAngleLeft = calcAngle(lm[11], lm[23], lm[27]);
        const bodyAngleRight = calcAngle(lm[12], lm[24], lm[28]);
        const bodyAngle = Math.round((bodyAngleLeft + bodyAngleRight) / 2);

        const kneeAngleLeft = calcAngle(lm[23], lm[25], lm[27]);
        const kneeAngleRight = calcAngle(lm[24], lm[26], lm[28]);
        const kneeAngle = Math.round((kneeAngleLeft + kneeAngleRight) / 2);

        const leftShoulderX = lm[11].x;
        const rightShoulderX = lm[12].x;
        const leftWristX = lm[15].x;
        const rightWristX = lm[16].x;
        
        const shoulderWidth = Math.abs(rightShoulderX - leftShoulderX);
        const handWidth = Math.abs(rightWristX - leftWristX);
        const handWidthRatio = handWidth / shoulderWidth;

        const bodyHeightDiff = Math.abs(shoulderY - hipY);
        const isHorizontal = bodyHeightDiff < this.thresholds.shoulderHipDiffMax && noseY < hipY;

        const elbowDiff = Math.abs(elbowLeft - elbowRight);
        const movementSynchronized = elbowDiff < 15;

        const handsPositionValid = handWidthRatio >= 1.0 && handWidthRatio <= 1.8;

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
                result.status = `📍 КАЛИБРОВКА: Опуститесь грудью к полу и держите 3 сек`;
                showHint(`Опуститесь вниз! Локоть: ${elbow}°`, this.svgIcons.bodyDown, 'rgba(59, 130, 246, 0.95)');
                
                if (bodyLineCorrect && kneeAngle >= this.thresholds.kneeAngleMin && 
                    bodyAspectRatio >= this.thresholds.minBodyAspectRatio) {
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
                result.status = `📍 КАЛИБРОВКА: Выпрямите руки полностью и держите 3 сек`;
                showHint(`Выпрямите руки! Локоть: ${elbow}°`, this.svgIcons.bodyUp, 'rgba(59, 130, 246, 0.95)');
                
                if (bodyLineCorrect && kneeAngle >= this.thresholds.kneeAngleMin && 
                    bodyAspectRatio >= this.thresholds.minBodyAspectRatio) {
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

        // ========== ОСТАЛЬНЫЕ ПРОВЕРКИ ==========

        // ПРОВЕРКА: Колени согнуты (сидя)
        if (kneeAngle < this.thresholds.kneeAngleMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ КОЛЕНИ СОГНУТЫ! ${kneeAngle}° (нужно >${this.thresholds.kneeAngleMin}°)`;
            showHint('ВЫПРЯМИТЕ НОГИ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Запястья выше плеч (руки в воздухе)
        const wristBelowShoulder = wristY - shoulderY;
        if (wristBelowShoulder < this.thresholds.wristBelowShoulderMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ РУКИ В ВОЗДУХЕ! Опустите руки на пол!`;
            showHint('РУКИ НА ПОЛ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Наклоны головы
        const headShoulderRatio = noseY / shoulderY;
        if (headShoulderRatio > this.thresholds.headShoulderRatioMax || 
            headShoulderRatio < this.thresholds.headShoulderRatioMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ НЕПРАВИЛЬНОЕ ПОЛОЖЕНИЕ ГОЛОВЫ! Соотношение: ${headShoulderRatio.toFixed(2)}`;
            showHint('ДЕРЖИТЕ ГОЛОВУ РОВНО!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Тело не горизонтально
        if (!isHorizontal) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = '❌ Тело не горизонтально!';
            showHint('Примите положение планки!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Тело не прямое
        if (!bodyLineCorrect) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ Угол тела: ${bodyAngle}° (нужно ${this.thresholds.bodyAngleMin}-${this.thresholds.bodyAngleMax}°)`;
            showHint('Держите тело прямо!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Руки поставлены неправильно
        if (!handsPositionValid) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ Ширина рук: ${handWidthRatio.toFixed(2)}x (нужно 1.0-1.8x)`;
            showHint('Неправильная постановка рук!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ПРОВЕРКА: Движение несинхронное
        if (!movementSynchronized) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ Разница локтей: ${elbowDiff}°`;
            showHint('Опускайтесь равномерно!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            return result;
        }

        // ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ
        state.consecutiveValidFrames++;
        state.failedChecks = 0;
        state.lastErrorType = null;

        const minValidFrames = 8;  // Увеличено до 8 кадров

        // ОПУСКАНИЕ
        if (state.position === 'up' && elbow < this.thresholds.elbowDown) {
            if (state.consecutiveValidFrames >= minValidFrames) {
                state.position = 'down';
                result.counted = true;
                result.correct = true;
                result.status = `✅ ЗАСЧИТАНО! Локоть: ${elbow}°`;
                showHint('✅ ОТЛИЧНО!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
            } else {
                result.status = `⏳ Удерживайте... (${state.consecutiveValidFrames}/${minValidFrames})`;
            }
        } 
        // ПОДЪЁМ
        else if (state.position === 'down' && elbow > this.thresholds.elbowUp) {
            state.position = 'up';
            result.status = `✅ Готов! (${elbow}°)`;
            showHint('Готов к следующему', this.svgIcons.bodyDown);
        }
        // ПРОМЕЖУТОЧНОЕ
        else {
            if (state.position === 'up') {
                result.status = `⬇️ Опускайтесь! ${elbow}° → <${this.thresholds.elbowDown}°`;
            } else {
                result.status = `⬆️ Выпрямляйтесь! ${elbow}° → >${this.thresholds.elbowUp}°`;
            }
        }

        return result;
    }
};
