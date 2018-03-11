 
//For use with the base64 version.

$(function(){
    
    var $ajax_div = $("div#ajax");
    
    $("form#soratama").submit(function(e){
        e.preventDefault();
        var formData = new FormData($(this)[0]);
        var loading = $("<div>").addClass("donut");
        $ajax_div.append(loading);
        $.ajax({
            type: "POST",
            url: "http://localhost:8010/dizzy-165804/us-central1/soratamafy?base64",
            data: formData,
            processData: false,
            contentType: false,
            dataType: "html",
            success: function(data) {
                //process data
                data = $(data).attr('height','600').attr('width', '800').attr('title', 'reality-marble');
                $ajax_div.append(data);
                
            },
            error: function(data) {
            //process error msg
                $ajax_div.append($("<span>").text(data.message));
            }
        }).done(function(){
                loading.remove();
            });
    });
});
