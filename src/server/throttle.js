'use strict';

const { Transform } = require('stream');

/**
 * 创建限速转换流（令牌桶简化实现）
 * @param {number} bytesPerSecond 每秒字节数；<=0 或 falsy 表示不限速（返回 null）
 * @returns {Transform|null}
 */
function createThrottleStream(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;

  let allowance = bytesPerSecond; // 初始允许 1 秒突发额度
  let last = Date.now();

  return new Transform({
    highWaterMark: 64 * 1024,
    transform(chunk, enc, cb) {
      const now = Date.now();
      const elapsed = (now - last) / 1000;
      last = now;
      allowance = Math.min(bytesPerSecond * 2, allowance + elapsed * bytesPerSecond);

      if (allowance >= chunk.length) {
        allowance -= chunk.length;
        cb(null, chunk);
      } else {
        // 额度不足：按不足部分计算需等待的毫秒数
        const waitMs = Math.max(1, ((chunk.length - allowance) / bytesPerSecond) * 1000);
        allowance = 0;
        const timer = setTimeout(() => cb(null, chunk), waitMs);
        if (typeof timer.unref === 'function') timer.unref();
      }
    }
  });
}

/**
 * 带限速的请求体管道（用于上传限速）
 * 通过 pause/resume 实现，返回写入的总字节数
 */
function pipeBodyWithLimit(req, writeStream, bytesPerSecond) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let windowReceived = 0;
    let windowStart = Date.now();
    let aborted = false;

    const onData = (chunk) => {
      received += chunk.length;
      windowReceived += chunk.length;
      if (bytesPerSecond > 0) {
        const elapsedSec = Math.max((Date.now() - windowStart) / 1000, 0.001);
        const budget = bytesPerSecond * elapsedSec;
        if (windowReceived > budget + chunk.length * 4) {
          // 超出本窗口预算，暂停到欠额消化完
          req.pause();
          const waitMs = Math.max(50, ((windowReceived - budget) / bytesPerSecond) * 1000);
          const timer = setTimeout(() => {
            windowStart = Date.now();
            windowReceived = 0;
            req.resume();
          }, waitMs);
          if (typeof timer.unref === 'function') timer.unref();
        }
      }
    };

    const onError = (err) => {
      if (aborted) return;
      aborted = true;
      cleanup();
      writeStream.destroy();
      reject(err);
    };

    const onClose = () => {
      if (!writeStream.writableEnded) {
        aborted = true;
        cleanup();
        writeStream.destroy();
        reject(new Error('客户端中断连接'));
      }
    };

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
      writeStream.removeListener('finish', onFinish);
      writeStream.removeListener('error', onError);
    }

    const onFinish = () => {
      cleanup();
      resolve(received);
    };

    req.on('data', onData);
    req.on('error', onError);
    req.on('close', onClose);
    writeStream.on('finish', onFinish);
    writeStream.on('error', onError);

    req.pipe(writeStream);
  });
}

module.exports = { createThrottleStream, pipeBodyWithLimit };
