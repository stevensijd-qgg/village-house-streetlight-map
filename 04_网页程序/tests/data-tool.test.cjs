const test = require("node:test");
const assert = require("node:assert/strict");
const { withBrowserPage } = require("./helpers/edge-cdp.cjs");

const houseTable = "测点编号\t经度\t纬度\n26001\t112.89\t28.40";

test("空村名阻止生成并清除旧输出", async () => {
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "";
      document.querySelector("#tHouse").value = ${JSON.stringify(houseTable)};
      document.querySelector("#out").value = "旧输出";
      document.querySelector("#btnDl").disabled = false;
      gen();
      return {
        message: document.querySelector("#msg").textContent,
        className: document.querySelector("#msg").className,
        output: document.querySelector("#out").value,
        disabled: document.querySelector("#btnDl").disabled,
      };
    })()`);
    assert.equal(actual.message, "请填写村名，不能留空。");
    assert.equal(actual.className, "err");
    assert.equal(actual.output, "");
    assert.equal(actual.disabled, true);
  });
});

test("表格出错时也清除旧输出，不能下载旧 data.js", async () => {
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "何桥村";
      document.querySelector("#tHouse").value = "只有表头";
      document.querySelector("#out").value = "旧输出";
      document.querySelector("#btnDl").disabled = false;
      gen();
      return {
        output: document.querySelector("#out").value,
        disabled: document.querySelector("#btnDl").disabled,
      };
    })()`);
    assert.deepEqual(actual, { output: "", disabled: true });
  });
});

test("对外展示模式不写入姓名电话，重复编号被跳过", async () => {
  const table = "测点编号\t房主姓名\t联系电话\t经度\t纬度\n" +
    "A001\t张三\t13800000000\t112.89\t28.40\n" +
    "A001\t李四\t13900000000\t112.88\t28.41";
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "测试村";
      document.querySelector("#pub").checked = true;
      document.querySelector("#tHouse").value = ${JSON.stringify(table)};
      gen();
      return {
        output: document.querySelector("#out").value,
        message: document.querySelector("#msg").textContent,
      };
    })()`);
    assert.match(actual.output, /publicMode: true/);
    assert.doesNotMatch(actual.output, /张三|李四|13800000000|13900000000/);
    assert.match(actual.message, /闲置房屋 1 处/);
    assert.match(actual.message, /A001 重复/);
  });
});

test("填写何桥村时生成正确 CONFIG", async () => {
  await withBrowserPage("数据更新工具.html", async page => {
    const actual = await page.evaluate(`(() => {
      document.querySelector("#village").value = "何桥村";
      document.querySelector("#tHouse").value = ${JSON.stringify(houseTable)};
      gen();
      return {
        message: document.querySelector("#msg").textContent,
        output: document.querySelector("#out").value,
        disabled: document.querySelector("#btnDl").disabled,
      };
    })()`);
    assert.match(actual.message, /生成成功：闲置房屋 1 处/);
    assert.match(actual.output, /villageName: "何桥村"/);
    assert.equal(actual.disabled, false);
  });
});
