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
        error: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
        // NEW: Иконки для калибровки
        calibration: '<svg width="64" height="64" viewBox="0 0 64 64" fill="white">ircle cx="32" cy="32" r="28" stroke="white" stroke-width="3"3" fill="none"/><path d="M32 12 L32 32 L45 32" stroke="white" stroke-width="3"/></svg>',
        step1: '<svg width="64" height="64" viewBox="0 0 64 64" fill="white">ircle cx="32" cy="32" r="28" fillll="#3b82f6"/><text x="32" y="42" font-size="32" font-weight="bold" text-anchor="middle" fill="white">1</text></svg>',
        step2: '<svg width="64" height="64" viewBox="0 0 64 64" fill="white">ircle cx="32" cy="="32" r="28" fill="#3b82f6"/><text x="32" y="42" font-size="32" font-weight="bold" text-anchor="middle" fill="white">2</text></svg>',
        step3: '<svg width="64" height="64" viewBox="0 0 64 64" fill="white">ircle cx="32" cy="32" r="28"8" fill="#10b981"/><text x="32" y="42" font-size="32" font-weight="bold" text-anchor="middle" fill="white">✓</text></svg>'
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
        minBodyAspectRatio: 1.5,
        maxBodyAspectRatio: 4.0,
        minNoseToAnkleDistance: 0.4,
        shoulderMaxYPosition: 0.7,
        ankleMinYPosition: 0.5,
        wristNoseYDiffMax: 0.15
    },

    getInitialState() {
        return { 
            position: 'up',
            calibrationStep: 0,  // 0-2: калибровка, 3: завершена
            calibrationSamples: [],
            calibratedMin: null,
            calibratedMax: null,
            failedChecks: 0,
            consecutiveValidFrames: 0,
            lastErrorType: null
        };
    },

    calculateDistance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    },

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

    // NEW: Функция для отображения прогресса калибровки
    getCalibrationProgress(state) {
        const totalSamplesNeeded = 60;
        const currentSamples = state.calibrationSamples.length;
        const percentage = Math.round((currentSamples / totalSamplesNeeded) * 100);
        
        return {
            percentage: percentage,
            samplesCollected: currentSamples,
            samplesNeeded: totalSamplesNeeded,
            remainingSeconds: Math.ceil((totalSamplesNeeded - currentSamples) / 20) // ~20 кадров/сек
        };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        
        // ========== КРИТИЧЕСКАЯ ПРОВЕРКА #0: ВИДИМОСТЬ ==========
        const visibilityCheck = this.checkLandmarksVisibility(lm);
        if (!visibilityCheck.valid) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
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

        const bodyWidth = Math.max(
            Math.abs(shoulderRight.x - shoulderLeft.x),
            Math.abs(lm[16].x - lm[15].x),
            Math.abs(ankleRight.x - ankleLeft.x)
        );
        const bodyHeight = Math.abs(ankleY - noseY);
        const bodyAspectRatio = bodyWidth / bodyHeight;

        const noseToAnkleDistLeft = this.calculateDistance(lm[0], ankleLeft);
        const noseToAnkleDistRight = this.calculateDistance(lm[0], ankleRight);
        const noseToAnkleDist = (noseToAnkleDistLeft + noseToAnkleDistRight) / 2;

        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = Math.round((elbowLeft + elbowRight) / 2);

        const bodyAngleLeft = calcAngle(lm[11], lm[23], lm[27]);
        const bodyAngleRight = calcAngle(lm[12], lm[24], lm[28]);
        const bodyAngle = Math.round((bodyAngleLeft + bodyAngleRight) / 2);

        const kneeAngleLeft = calcAngle(lm[23], lm[25], lm[27]);
        const kneeAngleRight = calcAngle(lm[24], lm[26], lm[28]);
        const kneeAngle = Math.round((kneeAngleLeft + kneeAngleRight) / 2);

        const bodyHeightDiff = Math.abs(shoulderY - hipY);
        const isHorizontal = bodyHeightDiff < this.thresholds.shoulderHipDiffMax && noseY < hipY;
        
        const bodyLineCorrect = bodyAngle >= this.thresholds.bodyAngleMin && 
                                 bodyAngle <= this.thresholds.bodyAngleMax;

        let result = { counted: false, correct: false, status: '' };

        // ========== КАЛИБРОВКА С ЧЕТКИМИ ЭТАПАМИ ==========
        if (state.calibrationStep < 3) {
            
            // БАЗОВАЯ ПРОВЕРКА перед калибровкой
            if (bodyAspectRatio < this.thresholds.minBodyAspectRatio) {
                result.status = `🚫 СНАЧАЛА ЛЯГТЕ В ПЛАНКУ! Вы сидите/стоите (соотношение ${bodyAspectRatio.toFixed(1)})`;
                showHint('❌ ЛЯГТЕ ГОРИЗОНТАЛЬНО!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
                state.calibrationSamples = []; // Сбрасываем прогресс если человек встал
                return result;
            }

            if (!isHorizontal || kneeAngle < this.thresholds.kneeAngleMin) {
                result.status = `🚫 ПРИМИТЕ ПРАВИЛЬНОЕ ПОЛОЖЕНИЕ! Тело должно быть в планке, ноги прямые`;
                showHint('Встаньте в ПЛАНКУ правильно!', this.svgIcons.bodyStraight, 'rgba(239, 68, 68, 0.95)');
                state.calibrationSamples = []; // Сбрасываем прогресс
                return result;
            }

            // ========== ШАГ 1: ОПУСКАНИЕ ВНИЗ ==========
            if (state.calibrationStep === 0) {
                const progress = this.getCalibrationProgress(state);
                
                result.status = `🔧 КАЛИБРОВКА - ШАГ 1 из 3\n` +
                               `📍 ОПУСТИТЕСЬ ГРУДЬЮ К ПОЛУ И ДЕРЖИТЕ\n` +
                               `⏱️ Удерживайте позицию: ${progress.remainingSeconds} сек\n` +
                               `📊 Прогресс: ${progress.percentage}% (${progress.samplesCollected}/${progress.samplesNeeded})\n` +
                               `🔢 Угол локтя: ${elbow}°`;
                
                showHint(
                    `⬇️ ШАГ 1/3: ОПУСТИТЕСЬ ВНИЗ!\n${progress.percentage}% [${'█'.repeat(Math.floor(progress.percentage/10))}${'░'.repeat(10-Math.floor(progress.percentage/10))}]`,
                    this.svgIcons.step1,
                    'rgba(59, 130, 246, 0.98)'
                );
                
                // Калибруем только при правильной технике
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
            // ========== ШАГ 2: ПОДЪЁМ ВВЕРХ ==========
            else if (state.calibrationStep === 1) {
                const progress = this.getCalibrationProgress(state);
                
                result.status = `🔧 КАЛИБРОВКА - ШАГ 2 из 3\n` +
                               `📍 ВЫПРЯМИТЕ РУКИ ПОЛНОСТЬЮ И ДЕРЖИТЕ\n` +
                               `⏱️ Удерживайте позицию: ${progress.remainingSeconds} сек\n` +
                               `📊 Прогресс: ${progress.percentage}% (${progress.samplesCollected}/${progress.samplesNeeded})\n` +
                               `🔢 Угол локтя: ${elbow}°`;
                
                showHint(
                    `⬆️ ШАГ 2/3: ВЫПРЯМИТЕ РУКИ!\n${progress.percentage}% [${'█'.repeat(Math.floor(progress.percentage/10))}${'░'.repeat(10-Math.floor(progress.percentage/10))}]`,
                    this.svgIcons.step2,
                    'rgba(59, 130, 246, 0.98)'
                );
                
                // Калибруем только при правильной технике
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
            // ========== ШАГ 3: ЗАВЕРШЕНИЕ ==========
            else if (state.calibrationStep === 2) {
                result.status = `✅ КАЛИБРОВКА ЗАВЕРШЕНА - ШАГ 3 из 3\n` +
                               `📊 Результаты:\n` +
                               `   • Нижняя точка: ${state.calibratedMin}°\n` +
                               `   • Верхняя точка: ${state.calibratedMax}°\n` +
                               `   • Порог опускания: <${this.thresholds.elbowDown}°\n` +
                               `   • Порог подъёма: >${this.thresholds.elbowUp}°\n\n` +
                               `🎯 НАЧИНАЙТЕ ОТЖИМАТЬСЯ!`;
                
                showHint(
                    '✅ ШАГ 3/3: ГОТОВО!\n100% [██████████]',
                    this.svgIcons.step3,
                    'rgba(16, 185, 129, 0.98)'
                );
                
                setTimeout(() => {
                    state.calibrationStep = 3;
                }, 3000);
            }
            
            return result;
        }

        // ========== ОБЫЧНЫЙ РЕЖИМ ==========
        
        // Все критические проверки из предыдущей версии...
        if (bodyAspectRatio < this.thresholds.minBodyAspectRatio) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌❌❌ ВЫ СИДИТЕ! Соотношение: ${bodyAspectRatio.toFixed(2)}`;
            showHint('ЛЯГТЕ ГОРИЗОНТАЛЬНО!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (noseToAnkleDist < this.thresholds.minNoseToAnkleDistance) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌❌ ТЕЛО НЕ РАСТЯНУТО! ${(noseToAnkleDist * 100).toFixed(1)}%`;
            showHint('РАСТЯНИТЕ ТЕЛО!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (shoulderY < this.thresholds.shoulderMaxYPosition) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌❌ ПЛЕЧИ СЛИШКОМ ВЫСОКО! ${(shoulderY * 100).toFixed(0)}%`;
            showHint('ВЫ СИДИТЕ/СТОИТЕ!', this.svgIcons.error, 'rgba(255, 0, 0, 0.98)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (kneeAngle < this.thresholds.kneeAngleMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ КОЛЕНИ СОГНУТЫ! ${kneeAngle}°`;
            showHint('ВЫПРЯМИТЕ НОГИ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        const wristBelowShoulder = wristY - shoulderY;
        if (wristBelowShoulder < this.thresholds.wristBelowShoulderMin) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ РУКИ В ВОЗДУХЕ!`;
            showHint('РУКИ НА ПОЛ!', this.svgIcons.error, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (!isHorizontal) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = '❌ Тело не горизонтально!';
            showHint('Положение планки!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        if (!bodyLineCorrect) {
            state.consecutiveValidFrames = 0;
            state.failedChecks++;
            result.status = `❌ Угол тела: ${bodyAngle}°`;
            showHint('Держите тело прямо!', this.svgIcons.warning, 'rgba(239, 68, 68, 0.95)');
            if (state.failedChecks > 30) state.position = 'up';
            return result;
        }

        // ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ
        state.consecutiveValidFrames++;
        state.failedChecks = 0;
        state.lastErrorType = null;

        const minValidFrames = 8;

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
