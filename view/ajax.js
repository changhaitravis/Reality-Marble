// For use with the base64 version.

$(function() {
    var $ajax_div = $("div#ajax");

    $("form#soratama").submit(function(e) {
        e.preventDefault();
        var form = $(this);
        var targetUrl = form.attr("action") || "/soratamafy?base64";
        var formData = new FormData(form[0]);
        var loading = $("<div>").addClass("donut");
        $ajax_div.append(loading);

        $.ajax({
            type: "POST",
            url: targetUrl,
            data: formData,
            processData: false,
            contentType: false,
            dataType: "html",
            success: function(data) {
                var $img = $(data).attr('height', '600').attr('width', '800').attr('title', 'reality-marble');
                $ajax_div.append($img);
            },
            error: function(xhr, status, error) {
                var msg = (xhr.responseJSON && xhr.responseJSON.message) || xhr.responseText || error || "Upload failed";
                $ajax_div.append($("<span>").css("color", "red").text("Error: " + msg));
            }
        }).done(function() {
            loading.remove();
        });
    });
});
